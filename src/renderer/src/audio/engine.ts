/**
 * The shared Web Audio engine.
 *
 * Two contexts are used on purpose:
 *
 *  - **capture** runs at 16 kHz. Whisper wants 16 kHz mono audio, and asking
 *    the browser for a 16 kHz context makes it resample the microphone for
 *    us — no anti-aliasing guesswork in JavaScript.
 *  - **playback** runs at the device's native rate, so the assistant's own
 *    voice sounds as good as the source allows.
 *
 * The output device is chosen with `AudioContext.setSinkId`, which is the
 * only reliable way to route generated audio to a specific speaker in
 * Chromium.
 */

export type AudioSource = "none" | "mic" | "output" | "idle"

/** Samples per chunk pushed to the capture callback (64 ms at 16 kHz). */
const CAPTURE_CHUNK = 1024

/** The sample rate every speech recogniser expects. */
export const CAPTURE_SAMPLE_RATE = 16000

interface SinkCapableContext extends AudioContext {
  setSinkId?: (deviceId: string) => Promise<void>
  /** The device the context is currently routed to. */
  sinkId?: string
}

class AudioEngine {
  private captureCtx: AudioContext | null = null
  private playbackCtx: AudioContext | null = null

  private analyser: AnalyserNode | null = null
  private micAnalyser: AnalyserNode | null = null
  private micStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private captureNode: AudioWorkletNode | ScriptProcessorNode | null = null
  private outputSource: MediaElementAudioSourceNode | null = null
  private activeSource: AudioBufferSourceNode | null = null

  private data: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(128))
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(128))

  /** Samples captured since the last flush. */
  private pending = new Float32Array(CAPTURE_CHUNK)
  private pendingCount = 0

  /** Called with each block of captured 16 kHz mono audio. */
  onSamples: ((samples: Float32Array) => void) | null = null

  source: AudioSource = "none"
  /** Smoothed 0..1 energy level. */
  level = 0
  /** Peak level within the current window. */
  peak = 0
  /** The microphone device that is currently open. */
  inputDeviceId = ""
  /** The speaker device that is currently selected. */
  outputDeviceId = ""
  /**
   * True once the playback graph reaches the audio destination.
   *
   * A Web Audio node is only audible when it is connected to the
   * destination, directly or through another node. This flag makes a
   * missing connection visible instead of silently producing silence.
   */
  outputWired = false

  /* ───────────────────────  Contexts  ─────────────────────── */

  private ensureCaptureContext(): AudioContext {
    if (!this.captureCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.captureCtx = new Ctor({ sampleRate: CAPTURE_SAMPLE_RATE })
    }
    return this.captureCtx
  }

  private ensurePlaybackContext(): AudioContext {
    if (!this.playbackCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.playbackCtx = new Ctor()
      this.analyser = this.playbackCtx.createAnalyser()
      this.analyser.fftSize = 1024
      this.analyser.smoothingTimeConstant = 0.78
      this.data = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))
      this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
      // The analyser is a leaf: it taps the signal for the visualiser and
      // sends nothing on. The audio itself is connected to the destination
      // where it is played.
      this.outputWired = true
    }
    return this.playbackCtx
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser
  }

  /** Resume both contexts — browsers start them suspended until a gesture. */
  async resume(): Promise<void> {
    const capture = this.ensureCaptureContext()
    if (capture.state === "suspended") await capture.resume().catch(() => undefined)

    const playback = this.ensurePlaybackContext()
    if (playback.state === "suspended") await playback.resume().catch(() => undefined)
  }

  /* ───────────────────────  Capture  ─────────────────────── */

  /**
   * Open the microphone and start delivering 16 kHz mono audio.
   *
   * The device id is passed straight through to `getUserMedia`, so the user
   * can pick exactly which microphone JARVIS listens to.
   */
  async startCapture(deviceId = ""): Promise<void> {
    await this.resume()
    this.stopCapture()

    const ctx = this.ensureCaptureContext()

    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {})
      }
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    // Another capture may have started while the permission prompt was open.
    // The stream that lost the race has to be released, or the microphone
    // stays open for the rest of the session.
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop()
      this.micStream = null
    }

    this.micStream = stream
    const track = stream.getAudioTracks()[0]
    this.inputDeviceId = track?.getSettings?.().deviceId ?? deviceId

    this.micSource = ctx.createMediaStreamSource(this.micStream)

    // A dedicated analyser drives the "listening" ring while the mic is open.
    this.micAnalyser = ctx.createAnalyser()
    this.micAnalyser.fftSize = 512
    this.micAnalyser.smoothingTimeConstant = 0.7
    this.micSource.connect(this.micAnalyser)

    this.captureNode = await this.createCaptureNode(ctx, this.micAnalyser)
    this.source = "mic"
  }

  /**
   * Build the node that hands us raw samples.
   *
   * An AudioWorklet is preferred; the deprecated ScriptProcessor is used as
   * a fallback so the microphone still works if worklets are unavailable.
   */
  private async createCaptureNode(
    ctx: AudioContext,
    analyser: AnalyserNode
  ): Promise<AudioWorkletNode | ScriptProcessorNode> {
    const workletCode = `
class JarvisCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (input && input.length) {
      this.port.postMessage(new Float32Array(input))
    }
    return true
  }
}
registerProcessor('jarvis-capture', JarvisCaptureProcessor)
`

    if (ctx.audioWorklet) {
      let url: string | null = null
      try {
        url = URL.createObjectURL(new Blob([workletCode], { type: "application/javascript" }))
        await ctx.audioWorklet.addModule(url)

        const node = new AudioWorkletNode(ctx, "jarvis-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1
        })
        node.port.onmessage = (event: MessageEvent) => this.pushSamples(event.data as Float32Array)
        this.micSource?.connect(node)
        node.connect(analyser)
        return node
      } catch {
        /* fall through to the script processor */
      } finally {
        // The object URL is released either way — a leak on every capture.
        if (url) URL.revokeObjectURL(url)
      }
    }

    const processor = ctx.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      this.pushSamples(new Float32Array(input))
    }
    this.micSource?.connect(processor)
    processor.connect(analyser)
    return processor
  }

  /** Collect samples into fixed-size blocks before handing them over. */
  private pushSamples(chunk: Float32Array): void {
    if (!chunk?.length) return
    let offset = 0
    while (offset < chunk.length) {
      const room = CAPTURE_CHUNK - this.pendingCount
      const take = Math.min(room, chunk.length - offset)
      this.pending.set(chunk.subarray(offset, offset + take), this.pendingCount)
      this.pendingCount += take
      offset += take

      if (this.pendingCount === CAPTURE_CHUNK) {
        const block = this.pending.slice(0)
        this.pendingCount = 0
        this.onSamples?.(block)
      }
    }
  }

  /** Close the microphone and release the capture graph. */
  stopCapture(): void {
    if (this.captureNode) {
      try {
        if ("port" in this.captureNode) this.captureNode.port.onmessage = null
        this.captureNode.disconnect()
      } catch {
        /* ignore */
      }
      this.captureNode = null
    }
    if (this.micSource) {
      try {
        this.micSource.disconnect()
      } catch {
        /* ignore */
      }
      this.micSource = null
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop()
      this.micStream = null
    }
    if (this.micAnalyser) {
      try {
        this.micAnalyser.disconnect()
      } catch {
        /* ignore */
      }
      this.micAnalyser = null
    }
    this.pendingCount = 0
    if (this.source === "mic") this.source = "none"
  }

  /** True while the microphone is open. */
  get isCapturing(): boolean {
    return this.micStream !== null
  }

  /* ───────────────────────  Output  ─────────────────────── */

  /**
   * Route all generated audio to a chosen speaker.
   *
   * Chromium implements `setSinkId` on the audio context, which covers every
   * source the app plays. The device id "default" — which is what the device
   * picker reports for the system output — means "do not redirect", so it is
   * never passed on: asking the platform for a literal device called
   * "default" can leave the context pointed at nothing at all, and the
   * assistant goes silent.
   */
  async setOutputDevice(deviceId: string): Promise<void> {
    const target = deviceId && deviceId !== "default" ? deviceId : ""
    this.outputDeviceId = target
    const ctx = this.ensurePlaybackContext() as SinkCapableContext
    if (typeof ctx.setSinkId !== "function") return

    try {
      await ctx.setSinkId(target)
      // The platform sometimes accepts an id it cannot actually use.
      if (ctx.sinkId && ctx.sinkId !== target) {
        console.warn(`[jarvis] the speaker could not be changed — using the default`)
        await ctx.setSinkId("")
        this.outputDeviceId = ""
      }
    } catch (err) {
      console.warn("[jarvis] the speaker could not be changed — using the default:", err)
      this.outputDeviceId = ""
      await ctx.setSinkId("").catch(() => undefined)
    }
  }

  /** Route an <audio> element into the analyser so speech is visualised. */
  attachOutput(element: HTMLAudioElement): void {
    const ctx = this.ensurePlaybackContext()
    if (this.outputSource) return
    try {
      this.outputSource = ctx.createMediaElementSource(element)
      // Taking the element's output into the graph diverts it from the
      // speakers, so the graph has to pass it on again.
      if (this.analyser) this.outputSource.connect(this.analyser)
      this.outputSource.connect(ctx.destination)
      this.source = "output"
      this.outputWired = true
    } catch {
      /* the element may already be attached — ignore */
    }
  }

  /**
   * Play a decoded audio buffer.
   *
   * Returns false when the audio graph could not be used, so the caller can
   * fall back to a plain media element — that path goes straight to the
   * system output and is the most reliable way to be heard.
   */
  async playBuffer(buffer: AudioBuffer): Promise<boolean> {
    const ctx = this.ensurePlaybackContext()
    if (ctx.state !== "running") {
      await ctx.resume().catch(() => undefined)
    }
    if (!this.analyser) return false

    // A context that will not run produces no sound at all.
    if (ctx.state !== "running") {
      console.warn("[jarvis] the audio context could not be started")
      return false
    }

    if (!this.outputWired) {
      // Without this the clip would be measured but never heard.
      console.warn("[jarvis] the playback graph is not connected to the audio output")
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer
    // Two separate paths: the analyser only taps the signal for the
    // visualiser, and the destination receives the audio directly. Leaving
    // the analyser to pass the sound on is the classic way to end up with a
    // visualiser that moves and a speaker that stays silent.
    source.connect(this.analyser)
    source.connect(ctx.destination)
    this.source = "output"
    this.activeSource = source

    // The number of inputs on the destination counts the sources that are
    // really wired to the speakers, which is the only way to be sure the
    // audio is not just being measured and thrown away.
    const inputs = ctx.destination.numberOfInputs
    if (inputs < 1) {
      console.warn("[jarvis] the audio is not connected to the speakers")
    }

    await new Promise<void>((resolve) => {
      source.onended = () => {
        this.activeSource = null
        if (this.source === "output") this.source = "none"
        // The clip reached the end of the graph, so it was really played.
        console.info(
          `[jarvis] played ${buffer.duration.toFixed(2)}s of audio (${inputs} source(s) on the output)`
        )
        resolve()
      }
      source.start()
    })
    return true
  }

  /**
   * Play a URL with a plain media element.
   *
   * This bypasses the Web Audio graph completely, so the audio goes
   * straight to the system output. It is the safety net: if the graph or
   * the decoder misbehaves, the assistant is still audible.
   */
  async playWithElement(url: string, routeThroughGraph: boolean): Promise<boolean> {
    const el = new Audio()
    el.crossOrigin = "anonymous"
    el.src = url
    el.volume = 1

    if (routeThroughGraph) {
      // Routing through the graph lets the visualiser react to the speech.
      this.attachOutput(el)
    }

    // The element can carry its own output device, which is more reliable
    // than redirecting the whole context.
    if (this.outputDeviceId) {
      const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      if (typeof sink.setSinkId === "function") {
        await sink.setSinkId(this.outputDeviceId).catch(() => undefined)
      }
    }

    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean): void => {
        el.removeEventListener("ended", onEnded)
        el.removeEventListener("error", onError)
        resolve(ok)
      }
      const onEnded = (): void => {
        console.info("[jarvis] played the clip through the system output")
        done(true)
      }
      const onError = (): void => {
        console.warn("[jarvis] the audio element could not play the clip")
        done(false)
      }
      el.addEventListener("ended", onEnded)
      el.addEventListener("error", onError)
      el.play().catch((err) => {
        console.warn("[jarvis] the audio element was refused:", err)
        done(false)
      })
    })
  }

  /** Decode an audio file fetched from a URL into an AudioBuffer. */
  async decode(url: string): Promise<AudioBuffer | null> {
    const ctx = this.ensurePlaybackContext()
    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.warn(`[jarvis] could not fetch the audio clip: HTTP ${res.status}`)
        return null
      }
      const data = await res.arrayBuffer()
      const buffer = await ctx.decodeAudioData(data)
      console.info(
        `[jarvis] decoded ${buffer.duration.toFixed(2)}s of ${res.headers.get("content-type") ?? "audio"}`
      )
      return buffer
    } catch (err) {
      console.warn("[jarvis] the audio could not be decoded:", err)
      return null
    }
  }

  /** Stop whatever is currently playing through the Web Audio graph. */
  stopOutput(): void {
    if (this.activeSource) {
      try {
        this.activeSource.stop()
      } catch {
        /* already stopped */
      }
      this.activeSource = null
    }
    if (this.source === "output") this.source = "none"
  }

  detachOutput(): void {
    if (this.outputSource) {
      try {
        this.outputSource.disconnect()
      } catch {
        /* ignore */
      }
      this.outputSource = null
    }
    if (this.source === "output") this.source = "none"
  }

  /* ───────────────────────  Analysis  ─────────────────────── */

  /**
   * Sample the analyser.
   *
   * While the microphone is open the capture context is measured, otherwise
   * the playback context is — so the ring reacts to whatever is happening.
   */
  sample(): number {
    const ctx = this.source === "mic" ? this.captureCtx : this.playbackCtx
    if (!ctx) {
      this.level *= 0.92
      this.peak *= 0.97
      return this.level
    }

    const analyser = this.source === "mic" ? this.micAnalyser : this.analyser
    if (!analyser) {
      this.level *= 0.92
      this.peak *= 0.97
      return this.level
    }

    // The buffers are reused, so the animation loop does not allocate sixty
    // times a second.
    if (this.data.length !== analyser.fftSize) {
      this.data = new Uint8Array(new ArrayBuffer(analyser.fftSize))
    }
    if (this.freq.length !== analyser.frequencyBinCount) {
      this.freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    }

    const timeData = this.data
    const freqData = this.freq
    analyser.getByteTimeDomainData(timeData)
    analyser.getByteFrequencyData(freqData)

    let sum = 0
    for (let i = 0; i < timeData.length; i++) {
      const v = (timeData[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / timeData.length)
    const normalised = Math.min(1, rms * 3.4)

    this.level = this.level * 0.72 + normalised * 0.28
    this.peak = Math.max(this.level, this.peak * 0.985)

    return this.level
  }

  getFrequencyData(): Uint8Array<ArrayBuffer> {
    return this.freq
  }

  getTimeDomainData(): Uint8Array<ArrayBuffer> {
    return this.data
  }

  /** The dominant frequency bin, useful for driving ring animations. */
  dominantBin(): number {
    const freq = this.freq
    if (!freq.length) return 0
    let best = 0
    let bestValue = 0
    const limit = Math.floor(freq.length * 0.6)
    for (let i = 1; i < limit; i++) {
      if (freq[i] > bestValue) {
        bestValue = freq[i]
        best = i
      }
    }
    return best / limit
  }

  /** Release everything. */
  async dispose(): Promise<void> {
    this.stopCapture()
    this.stopOutput()
    try {
      await this.captureCtx?.close()
    } catch {
      /* ignore */
    }
    try {
      await this.playbackCtx?.close()
    } catch {
      /* ignore */
    }
    this.captureCtx = null
    this.playbackCtx = null
  }
}

export const audioEngine = new AudioEngine()
