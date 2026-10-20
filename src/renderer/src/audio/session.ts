import { matchWakeWord, stripFillers } from "@shared/wake"
import { audioEngine, CAPTURE_SAMPLE_RATE } from "./engine"
import { BrowserRecognizer } from "./recognizer"
import { VoiceActivityDetector } from "./vad"
import { pickJarvisVoice, speakWithBrowser, stopBrowserSpeech } from "./speech"
import type { SttEngine, TtsEngine } from "@shared/types"

/**
 * The voice session.
 *
 * A single module-level object owns the microphone so that the HUD, the
 * composer and the settings dialog can all look at the same state without
 * fighting over the device. It supports three ways to talk to JARVIS:
 *
 *  - **Push to talk** — hold a key or the microphone button.
 *  - **Always on** — the microphone stays open and JARVIS listens for its
 *    wake word.
 *  - **Open mode** — always on, but every phrase is treated as a command.
 */

export interface VoiceSessionState {
  /** The microphone is open. */
  listening: boolean
  /** Always-on listening is armed. */
  alwaysOn: boolean
  /** A push-to-talk capture is in progress. */
  recording: boolean
  /** The audio is being recognised. */
  transcribing: boolean
  /** The assistant is speaking. */
  speaking: boolean
  /** The wake word was heard and JARVIS is waiting for the command. */
  awake: boolean
  /** Current microphone level, 0 – 1. */
  level: number
  /** The last thing that was heard. */
  lastTranscript: string
  /** The last error, if any. */
  error?: string
  /** Which speech recognition engine is in use. */
  sttEngine: SttEngine
  /** Which speech synthesis engine is in use. */
  ttsEngine: TtsEngine
}

const INITIAL_STATE: VoiceSessionState = {
  listening: false,
  alwaysOn: false,
  recording: false,
  transcribing: false,
  speaking: false,
  awake: false,
  level: 0,
  lastTranscript: "",
  error: undefined,
  sttEngine: "whisper",
  ttsEngine: "edge"
}

/** How long JARVIS stays awake after hearing only its name. */
const AWAKE_WINDOW_MS = 12_000

/**
 * Resolve the recognition engine.
 *
 * "auto" means the local Whisper model, which is the only engine that can
 * recognise a recorded buffer. The main process resolves this too, but the
 * renderer has to know which path to take before the first sample arrives.
 */
export function resolveSttEngine(engine: SttEngine): SttEngine {
  return engine === "auto" ? "whisper" : engine
}

/** The subset of the settings that the session needs. */
export interface SessionSettings {
  sttEngine: SttEngine
  ttsEngine: TtsEngine
  alwaysOn: boolean
  wakeMode: "wake-word" | "open" | "off"
  wakeWord: string
  wakeSensitivity: number
  silenceTimeoutMs: number
  inputDeviceId: string
  outputDeviceId: string
  rate: number
  pitch: number
  volume: number
  language: string
  browserVoice: string
}

class VoiceSession {
  private state: VoiceSessionState = { ...INITIAL_STATE }
  private listeners = new Set<(state: VoiceSessionState) => void>()

  /** Called with the text of a recognised command. */
  private commandHandler: ((text: string, spoken: boolean) => void) | null = null

  private vad: VoiceActivityDetector | null = null
  private recognizer: BrowserRecognizer | null = null

  /** Samples captured during a push-to-talk recording. */
  private pttChunks: Float32Array[] = []

  /** Text collected by the browser recogniser during a push-to-talk capture. */
  private browserPttText = ""
  private browserPttRecognizer: BrowserRecognizer | null = null

  private awakeUntil = 0
  /** The timer that puts the assistant back to sleep. */
  private awakeTimer: number | null = null
  /** True while the assistant is talking. */
  private speaking = false
  /**
   * Utterances are ignored for a moment after the assistant stops talking.
   *
   * The room keeps ringing after the last word, and the echo canceller
   * needs a moment to settle, so the tail of the assistant's own voice can
   * still reach the microphone.
   */
  private speakCooldownUntil = 0
  /** Counts the speech operations, so a cancelled one does not clear a newer. */
  private speakGeneration = 0
  private disposed = false

  /* ───────────────────────  Store  ─────────────────────── */

  getState(): VoiceSessionState {
    return this.state
  }

  subscribe(listener: (state: VoiceSessionState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(patch: Partial<VoiceSessionState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  /** Register the handler that receives recognised commands. */
  onCommand(handler: (text: string, spoken: boolean) => void): void {
    this.commandHandler = handler
  }

  /* ───────────────────────  Configuration  ─────────────────────── */

  /** Apply the settings that affect the session. */
  async applySettings(settings: SessionSettings): Promise<void> {
    // "auto" has to be resolved here: the renderer picks the listening path
    // from this value, and only Whisper can recognise a recorded buffer.
    const sttEngine = resolveSttEngine(settings.sttEngine)
    const engineChanged = this.state.sttEngine !== sttEngine
    this.set({ sttEngine, ttsEngine: settings.ttsEngine })

    // Route the output.
    if (audioEngine.outputDeviceId !== settings.outputDeviceId) {
      await audioEngine.setOutputDevice(settings.outputDeviceId).catch(() => undefined)
    }

    // A different recogniser means the listening strategy changes. A
    // push-to-talk capture in progress is left alone — restarting the
    // microphone now would throw the recording away.
    if (engineChanged && this.state.listening && !this.state.recording) {
      await this.stopListening()
      await this.startListening(settings.inputDeviceId, sttEngine)
      if (settings.alwaysOn) await this.setAlwaysOn(true, settings)
      return
    }

    if (this.vad) {
      this.vad.configure({
        sensitivity: settings.wakeSensitivity,
        silenceMs: settings.silenceTimeoutMs
      })
    }

    if (this.state.alwaysOn) {
      // The wake word may have changed — refresh the detector settings.
      this.configureVad(settings)
    }
  }

  private configureVad(settings: {
    wakeSensitivity: number
    silenceTimeoutMs: number
  }): void {
    this.vad?.configure({
      sensitivity: settings.wakeSensitivity,
      silenceMs: settings.silenceTimeoutMs
    })
  }

  /* ───────────────────────  Microphone  ─────────────────────── */

  /** The in-flight microphone open, so it is only ever started once. */
  private starting: Promise<void> | null = null

  /** Open the microphone. */
  async startListening(deviceId = "", sttEngine: SttEngine = this.state.sttEngine): Promise<void> {
    if (this.disposed) return
    if (this.state.listening) {
      // The device may have changed — reopen it.
      if (deviceId && deviceId !== audioEngine.inputDeviceId) {
        await this.stopListening()
      } else {
        return
      }
    }

    // Two callers can arrive here at once — the voice dock and the app both
    // arm always-on when the setting changes. Without this guard the second
    // call would open a second microphone stream and leak the first.
    if (this.starting) {
      await this.starting
      return
    }

    const engine = resolveSttEngine(sttEngine)

    this.starting = (async () => {
      try {
        await audioEngine.resume()
        await audioEngine.startCapture(deviceId)
        audioEngine.onSamples = (samples) => this.handleSamples(samples)
        this.set({ listening: true, sttEngine: engine, error: undefined })
      } catch (err) {
        // Release anything that was opened before the failure.
        audioEngine.stopCapture()
        const denied = err instanceof Error && err.name === "NotAllowedError"
        this.set({
          listening: false,
          error: denied
            ? "Microphone access was denied. Allow it in your system settings to talk to JARVIS."
            : `Could not open the microphone: ${err instanceof Error ? err.message : String(err)}`
        })
      } finally {
        this.starting = null
      }
    })()

    await this.starting
  }

  /** Close the microphone. */
  async stopListening(): Promise<void> {
    audioEngine.onSamples = null
    this.recognizer?.stop()
    this.recognizer = null
    this.browserPttRecognizer?.stop()
    this.browserPttRecognizer = null
    this.vad?.reset()
    audioEngine.stopCapture()
    this.pttChunks = []
    this.clearAwake()
    this.set({ listening: false, alwaysOn: false, recording: false })
  }

  /* ───────────────────────  Always on  ─────────────────────── */

  /**
   * Arm or disarm always-on listening.
   *
   * The microphone stays open, utterances are recognised in the background
   * and only the ones that contain the wake word are acted on.
   */
  async setAlwaysOn(
    on: boolean,
    settings?: {
      wakeMode?: "wake-word" | "open" | "off"
      wakeWord?: string
      wakeSensitivity?: number
      silenceTimeoutMs?: number
      inputDeviceId?: string
      sttEngine?: SttEngine
      language?: string
    }
  ): Promise<void> {
    // Keep the cached settings in step, so the wake word rules always use
    // the values the user can see in the settings.
    if (settings) {
      this.settingsCache = {
        wakeMode: settings.wakeMode ?? this.settingsCache?.wakeMode ?? "wake-word",
        wakeWord: settings.wakeWord ?? this.settingsCache?.wakeWord ?? "jarvis",
        wakeSensitivity: settings.wakeSensitivity ?? this.settingsCache?.wakeSensitivity ?? 0.5,
        silenceTimeoutMs: settings.silenceTimeoutMs ?? this.settingsCache?.silenceTimeoutMs ?? 1200,
        inputDeviceId: settings.inputDeviceId ?? this.settingsCache?.inputDeviceId ?? "",
        sttEngine: settings.sttEngine ?? this.settingsCache?.sttEngine ?? "whisper",
        language: settings.language ?? this.settingsCache?.language ?? "en-GB"
      }
    }

    if (!on) {
      this.set({ alwaysOn: false, awake: false })
      this.recognizer?.stop()
      this.recognizer = null
      this.vad?.reset()
      // Close the microphone, unless a push-to-talk capture is still running.
      if (!this.state.recording) await this.stopListening()
      return
    }

    if (!this.state.listening) {
      await this.startListening(settings?.inputDeviceId ?? "", settings?.sttEngine ?? this.state.sttEngine)
    }

    this.set({ alwaysOn: true, awake: false, error: undefined })

    const engine = resolveSttEngine(settings?.sttEngine ?? this.state.sttEngine)
    if (engine === "browser") {
      this.startBrowserRecogniser(settings?.language ?? "en-GB")
    } else {
      this.createVad(settings)
    }
  }

  private createVad(settings?: {
    wakeSensitivity?: number
    silenceTimeoutMs?: number
  }): void {
    const sensitivity = settings?.wakeSensitivity ?? this.settingsCache?.wakeSensitivity ?? 0.5
    const silenceMs = settings?.silenceTimeoutMs ?? this.settingsCache?.silenceTimeoutMs ?? 1200

    if (this.vad) {
      this.vad.configure({ sensitivity, silenceMs })
      return
    }

    this.vad = new VoiceActivityDetector(
      { sensitivity, silenceMs, sampleRate: CAPTURE_SAMPLE_RATE },
      {
        onSpeechEnd: (samples) => {
          void this.handleUtterance(samples)
        }
      }
    )
  }

  private startBrowserRecogniser(language: string): void {
    this.recognizer?.stop()
    const recognizer = new BrowserRecognizer()
    this.recognizer = recognizer
    recognizer.start(language, {
      onTranscript: (text, final) => {
        if (!final) return
        void this.handleText(text)
      },
      onError: (message) => this.set({ error: message })
    })
  }

  /* ───────────────────────  Sample routing  ─────────────────────── */

  private handleSamples(samples: Float32Array): void {
    // While JARVIS is speaking it must not listen to itself.
    if (this.speaking) return

    if (this.state.recording) {
      this.pttChunks.push(samples)
      return
    }

    if (this.state.alwaysOn && this.state.sttEngine === "whisper") {
      this.vad?.push(samples)
    }
  }

  /* ───────────────────────  Push to talk  ─────────────────────── */

  /** Begin a push-to-talk capture. */
  async startPtt(deviceId = "", sttEngine: SttEngine = this.state.sttEngine): Promise<void> {
    if (this.state.recording) return

    // Fall back to the configured microphone when no device was given.
    const target = deviceId || this.settingsCache?.inputDeviceId || ""

    if (!this.state.listening) {
      await this.startListening(target, sttEngine)
      if (!this.state.listening) return
    }

    this.pttChunks = []
    this.set({ recording: true, awake: false, error: undefined })

    // The browser recogniser cannot transcribe a recorded buffer — it has to
    // listen live, so it is started and stopped with the recording.
    if (resolveSttEngine(sttEngine) === "browser") {
      this.browserPttText = ""
      this.browserPttRecognizer?.stop()
      const recognizer = new BrowserRecognizer()
      this.browserPttRecognizer = recognizer
      recognizer.start(this.settingsCache?.language ?? "en-GB", {
        onTranscript: (text, final) => {
          if (final) this.browserPttText = text
        },
        onError: (message) => this.set({ error: message })
      })
    }
  }

  /** End a push-to-talk capture and return the transcript. */
  async endPtt(): Promise<string> {
    if (!this.state.recording) return ""
    this.set({ recording: false })

    // The browser recogniser path.
    if (this.browserPttRecognizer) {
      this.browserPttRecognizer.stop()
      this.browserPttRecognizer = null
      const text = this.browserPttText.trim()
      this.browserPttText = ""
      if (text) this.set({ lastTranscript: text })
      return text
    }

    const samples = this.concatenate(this.pttChunks)
    this.pttChunks = []
    if (!samples.length) return ""

    return this.transcribe(samples)
  }

  private concatenate(chunks: Float32Array[]): Float32Array {
    if (!chunks.length) return new Float32Array(0)
    const total = chunks.reduce((sum, c) => sum + c.length, 0)
    const out = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }

  /* ───────────────────────  Recognition  ─────────────────────── */

  /** Serialises the recognitions, so two cannot overlap. */
  private transcribeQueue: Promise<unknown> = Promise.resolve()

  /** Send audio to the recogniser and return the transcript. */
  async transcribe(samples: Float32Array): Promise<string> {
    this.set({ transcribing: true })
    try {
      const result = await window.jarvis.voice.transcribe({
        samples,
        sampleRate: CAPTURE_SAMPLE_RATE,
        // The configured language is used, not the literal "auto" — the main
        // process would treat "auto" as a real language name.
        language: this.settingsCache?.language || undefined
      })
      if (result.error) {
        this.set({ error: result.error })
        return ""
      }
      const text = (result.text ?? "").trim()
      this.set({ lastTranscript: text })
      return text
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) })
      return ""
    } finally {
      this.set({ transcribing: false })
    }
  }

  /**
   * An utterance finished. Work out whether it was meant for JARVIS.
   */
  private async handleUtterance(samples: Float32Array): Promise<void> {
    if (!samples.length) return

    // Ignore very short sounds — a click or a cough.
    if (samples.length < CAPTURE_SAMPLE_RATE * 0.18) return

    // Recognitions are chained, so the "transcribing" flag and the results
    // stay in step with each other.
    const run = this.transcribeQueue.then(async () => {
      // Always-on may have been switched off while this was in flight.
      if (!this.state.alwaysOn) return

      const text = await this.transcribe(samples)
      if (!text) return
      if (!this.state.alwaysOn) return
      // The assistant was talking while this was being recognised — the
      // microphone heard its own voice.
      if (this.speaking) return
      // The room was still ringing after the assistant stopped.
      if (Date.now() < this.speakCooldownUntil) return
      await this.handleText(text)
    })

    this.transcribeQueue = run.catch(() => undefined)
    await run
  }

  /** Apply the wake word rules to a transcript. */
  private async handleText(text: string): Promise<void> {
    // Never act on the assistant's own voice.
    if (this.speaking) return
    if (Date.now() < this.speakCooldownUntil) return

    const settings = await this.getSettings()
    if (!settings) return

    const mode = settings.wakeMode

    if (mode === "off") return

    if (mode === "open") {
      const command = stripFillers(text)
      if (command) this.commandHandler?.(command, true)
      return
    }

    // Wake word mode.
    const match = matchWakeWord(text, settings.wakeWord)

    if (match.matched) {
      const command = match.command
      if (command) {
        this.clearAwake()
        this.commandHandler?.(command, true)
      } else {
        // The user only said the name — wait for the actual command.
        this.set({ awake: true })
        this.awakeUntil = Date.now() + AWAKE_WINDOW_MS
        // The window has to expire on its own, or the assistant would stay
        // "awake" for ever and every later phrase would be a command.
        if (this.awakeTimer !== null) window.clearTimeout(this.awakeTimer)
        this.awakeTimer = window.setTimeout(() => {
          this.awakeTimer = null
          this.awakeUntil = 0
          this.set({ awake: false })
        }, AWAKE_WINDOW_MS)
      }
      return
    }

    // A command that follows "jarvis" in the same breath already went
    // through the matcher above, so anything left is either a follow-up
    // inside the awake window, or it was not meant for JARVIS.
    if (this.state.awake && Date.now() < this.awakeUntil) {
      const command = stripFillers(text)
      this.clearAwake()
      if (command) this.commandHandler?.(command, true)
    }
  }

  /** Go back to sleep. */
  private clearAwake(): void {
    if (this.awakeTimer !== null) {
      window.clearTimeout(this.awakeTimer)
      this.awakeTimer = null
    }
    this.awakeUntil = 0
    this.set({ awake: false })
  }

  /* ───────────────────────  Settings bridge  ─────────────────────── */

  private settingsCache: {
    wakeMode: "wake-word" | "open" | "off"
    wakeWord: string
    wakeSensitivity: number
    silenceTimeoutMs: number
    inputDeviceId: string
    sttEngine: SttEngine
    language: string
  } | null = null

  /** Keep the session in step with the stored settings. */
  setSettings(settings: {
    wakeMode: "wake-word" | "open" | "off"
    wakeWord: string
    wakeSensitivity: number
    silenceTimeoutMs: number
    inputDeviceId: string
    sttEngine: SttEngine
    language: string
  }): void {
    this.settingsCache = settings
  }

  private async getSettings(): Promise<typeof this.settingsCache> {
    if (this.settingsCache) return this.settingsCache
    const settings = await window.jarvis.settings.get()
    this.settingsCache = {
      wakeMode: settings.voice.wakeMode,
      wakeWord: settings.voice.wakeWord,
      wakeSensitivity: settings.voice.wakeSensitivity,
      silenceTimeoutMs: settings.voice.silenceTimeoutMs,
      inputDeviceId: settings.voice.inputDeviceId,
      sttEngine: settings.voice.sttEngine,
      language: settings.voice.language
    }
    return this.settingsCache
  }

  /* ───────────────────────  Speaking  ─────────────────────── */

  /** Speak a reply. Returns true when audio was actually produced. */
  async speak(text: string, options: { rate?: number; pitch?: number; volume?: number } = {}): Promise<boolean> {
    if (!text.trim()) return false

    // A generation counter, so a cancelled speech does not clear the state of
    // a newer one that has already started.
    const generation = ++this.speakGeneration
    this.speaking = true
    this.set({ speaking: true })

    // Anything the detector captured before this moment is discarded, and
    // the detector is reset afterwards — otherwise the assistant hears its
    // own voice through the microphone and answers itself.
    this.vad?.reset()

    try {
      const result = await window.jarvis.voice.speak({ text })

      if (result.ok && result.engine === "browser") {
        const settings = await window.jarvis.settings.get()
        const chosen = pickJarvisVoice(settings.voice.browserVoice)
        if (!chosen) return false
        await speakWithBrowser(text, {
          voice: chosen.name,
          rate: options.rate ?? settings.voice.rate,
          pitch: options.pitch ?? settings.voice.pitch,
          volume: options.volume ?? settings.voice.volume,
          lang: settings.voice.language
        })
        return true
      }

      if (result.ok && result.clipId) {
        const url = `jarvismedia://speech/${encodeURIComponent(result.clipId)}`
        return await this.playClip(url)
      }

      if (result.error) this.set({ error: result.error })
      return false
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) })
      return false
    } finally {
      // Discard whatever the microphone picked up while the assistant was
      // talking, so the assistant never answers itself. The cooldown covers
      // the reverberation that follows the last word.
      this.vad?.reset()
      this.speakCooldownUntil = Date.now() + 2000
      if (generation === this.speakGeneration) {
        this.speaking = false
        this.set({ speaking: false })
      }
    }
  }

  /**
   * Play a generated clip.
   *
   * The Web Audio path is tried first, because the visualiser reacts to the
   * speech. If the clip cannot be decoded it is played with a plain media
   * element instead, which goes straight to the system output — the
   * assistant must be audible even when the graph misbehaves.
   */
  private async playClip(url: string): Promise<boolean> {
    const buffer = await audioEngine.decode(url)
    if (buffer) {
      await audioEngine.playBuffer(buffer)
      return true
    }

    // The decoder refused the clip. Play it directly.
    const played = await audioEngine.playWithElement(url, true)
    if (played) return true

    // Last resort: bypass the graph completely.
    return audioEngine.playWithElement(url, false)
  }

  /** Stop whatever is being said. */
  stopSpeaking(): void {
    stopBrowserSpeech()
    audioEngine.stopOutput()
    // Bump the generation so the in-flight speech does not clear the state
    // of whatever starts next.
    this.speakGeneration++
    this.speaking = false
    this.set({ speaking: false })
  }

  /* ───────────────────────  Level  ─────────────────────── */

  /** Sample the analyser and publish the level. */
  tick(): number {
    const level = audioEngine.sample()
    if (Math.abs(level - this.state.level) > 0.01) this.set({ level })
    return level
  }

  /** Release everything. */
  dispose(): void {
    this.disposed = true
    void this.stopListening()
  }
}

export const voiceSession = new VoiceSession()
