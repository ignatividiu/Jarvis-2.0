/**
 * Browser speech recognition.
 *
 * This is the fallback recogniser, used when the local Whisper model is not
 * available. It relies on the Web Speech API, which Chromium implements on
 * top of the platform speech services — so it works on Windows and macOS
 * without any download, and is less dependable on Linux.
 *
 * Unlike Whisper, the browser recogniser cannot transcribe a recorded
 * buffer: it has to listen live. The session therefore switches the whole
 * listening strategy when this engine is selected.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number
  readonly results: {
    readonly length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string
  readonly message?: string
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Is the browser recogniser available in this build? */
export function browserRecognitionAvailable(): boolean {
  return recognitionCtor() !== null
}

export interface BrowserRecognizerCallbacks {
  /** A transcript was produced. `final` marks the end of an utterance. */
  onTranscript?: (text: string, final: boolean) => void
  onError?: (message: string) => void
  onStart?: () => void
  onEnd?: () => void
}

export class BrowserRecognizer {
  private recognition: SpeechRecognitionLike | null = null
  private wantRunning = false
  private callbacks: BrowserRecognizerCallbacks = {}
  private restartTimer: number | null = null

  get isRunning(): boolean {
    return this.wantRunning
  }

  /** Start listening. The recogniser restarts itself when the browser ends it. */
  start(language = "en-GB", callbacks: BrowserRecognizerCallbacks = {}): boolean {
    const Ctor = recognitionCtor()
    if (!Ctor) {
      callbacks.onError?.("This build of Chromium has no speech recogniser.")
      return false
    }

    this.callbacks = callbacks
    this.wantRunning = true

    const spawn = (): void => {
      if (!this.wantRunning) return

      const recognition = new Ctor()
      recognition.lang = language
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onstart = () => this.callbacks.onStart?.()

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const alternative = result[0]
          if (!alternative?.transcript) continue
          this.callbacks.onTranscript?.(alternative.transcript, result.isFinal)
        }
      }

      recognition.onerror = (event) => {
        // "no-speech" and "aborted" are routine, not failures.
        if (event.error === "no-speech" || event.error === "aborted") return
        this.callbacks.onError?.(event.message ?? event.error)
      }

      recognition.onend = () => {
        this.callbacks.onEnd?.()
        // Chromium stops the recogniser every so often — restart it.
        if (this.wantRunning) {
          this.restartTimer = window.setTimeout(spawn, 250)
        }
      }

      try {
        recognition.start()
        this.recognition = recognition
      } catch (err) {
        this.recognition = null
        this.wantRunning = false
        this.callbacks.onError?.(err instanceof Error ? err.message : String(err))
      }
    }

    spawn()
    return true
  }

  /** Stop listening. */
  stop(): void {
    this.wantRunning = false
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    try {
      this.recognition?.stop()
    } catch {
      /* ignore */
    }
    this.recognition = null
  }
}
