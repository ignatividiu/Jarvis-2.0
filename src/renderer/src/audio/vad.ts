/**
 * Voice activity detection.
 *
 * The detector watches the energy of the incoming microphone signal and
 * splits it into utterances. That is all the wake word needs: an utterance
 * is transcribed, and the transcript is checked for "jarvis".
 *
 * A purely energy-based detector would trip on a desk fan, so the noise
 * floor is tracked adaptively — the threshold always sits a fixed distance
 * above the quietest recent sound, whatever that happens to be.
 */

export interface VadOptions {
  /** 0 – 1. Higher means it triggers more easily. */
  sensitivity: number
  /** Silence after the last word that ends an utterance, in milliseconds. */
  silenceMs: number
  /** Audio kept before the speech starts, in milliseconds. */
  preRollMs: number
  /** Sample rate of the incoming audio. */
  sampleRate: number
  /** Longest utterance that is kept, in milliseconds. */
  maxUtteranceMs?: number
}

export interface VadCallbacks {
  onSpeechStart?: () => void
  onSpeechEnd?: (samples: Float32Array) => void
  onLevel?: (level: number) => void
}

const DEFAULTS: Required<VadOptions> = {
  sensitivity: 0.5,
  silenceMs: 1200,
  preRollMs: 600,
  sampleRate: 16000,
  maxUtteranceMs: 20_000
}

export class VoiceActivityDetector {
  private opts: Required<VadOptions>
  private callbacks: VadCallbacks

  /** The adaptive quiet floor. */
  private noiseFloor = 0.004
  /** The level above which audio counts as speech. */
  private threshold = 0.012

  /** Rolling buffer of the most recent audio, used as pre-roll. */
  private preRoll: Float32Array
  private preRollCount = 0

  /** The utterance being recorded. */
  private utterance: Float32Array
  private utteranceCount = 0

  private speaking = false
  /** Milliseconds of continuous speech so far. */
  private speechMs = 0
  /** Milliseconds of silence since the last speech. */
  private silenceMs = 0
  /** Consecutive loud chunks, used to confirm that speech really started. */
  private loudChunks = 0

  constructor(options: Partial<VadOptions> = {}, callbacks: VadCallbacks = {}) {
    this.opts = { ...DEFAULTS, ...options }
    this.callbacks = callbacks
    this.preRoll = new Float32Array(Math.ceil((this.opts.preRollMs / 1000) * this.opts.sampleRate))
    this.utterance = new Float32Array(Math.ceil((this.opts.maxUtteranceMs / 1000) * this.opts.sampleRate))
    this.recomputeThreshold()
  }

  /** Apply new options — the sensitivity and silence timeout can change live. */
  configure(options: Partial<VadOptions>): void {
    this.opts = { ...this.opts, ...options }
    this.recomputeThreshold()
  }

  private recomputeThreshold(): void {
    // A sensitivity of 1 sits close to the noise, 0 demands a clear signal.
    const ratio = 3.5 - Math.max(0, Math.min(1, this.opts.sensitivity)) * 2.5
    this.threshold = Math.max(0.005, this.noiseFloor * ratio)
  }

  /** The current energy threshold. */
  get currentThreshold(): number {
    return this.threshold
  }

  /** The current noise floor estimate. */
  get currentNoiseFloor(): number {
    return this.noiseFloor
  }

  get isSpeaking(): boolean {
    return this.speaking
  }

  /** Root mean square of a block of samples. */
  private rms(samples: Float32Array): number {
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i]
      sum += v * v
    }
    return Math.sqrt(sum / Math.max(1, samples.length))
  }

  /** Feed a block of 16 kHz mono audio into the detector. */
  push(samples: Float32Array): void {
    if (!samples?.length) return

    const level = this.rms(samples)
    this.callbacks.onLevel?.(level)

    // Track the quiet floor: fall quickly, rise very slowly.
    if (level < this.noiseFloor) {
      this.noiseFloor = this.noiseFloor * 0.85 + level * 0.15
    } else {
      this.noiseFloor = this.noiseFloor * 0.9995 + level * 0.0005
    }
    this.noiseFloor = Math.max(this.noiseFloor, 0.0012)
    this.recomputeThreshold()

    const chunkMs = (samples.length / this.opts.sampleRate) * 1000
    const loud = level > this.threshold
    const quiet = level < this.threshold * 0.75

    if (!this.speaking) {
      // Push into the pre-roll so the start of a word is never clipped.
      this.pushPreRoll(samples)

      if (loud) {
        this.loudChunks += 1
        // A couple of loud chunks in a row is a real sound, not a click.
        if (this.loudChunks >= 2) {
          this.speaking = true
          this.speechMs = 0
          this.silenceMs = 0
          this.utteranceCount = 0
          this.appendToUtterance(this.preRoll.subarray(0, this.preRollCount))
          this.callbacks.onSpeechStart?.()
        }
      } else {
        this.loudChunks = 0
      }
      return
    }

    this.appendToUtterance(samples)
    this.speechMs += chunkMs

    if (quiet) {
      this.silenceMs += chunkMs
    } else {
      this.silenceMs = 0
    }

    const tooLong = this.speechMs > this.opts.maxUtteranceMs
    if (this.silenceMs >= this.opts.silenceMs || tooLong) {
      this.finishUtterance()
    }
  }

  private pushPreRoll(samples: Float32Array): void {
    if (samples.length >= this.preRoll.length) {
      this.preRoll.set(samples.subarray(samples.length - this.preRoll.length))
      this.preRollCount = this.preRoll.length
      return
    }
    if (this.preRollCount + samples.length > this.preRoll.length) {
      const overflow = this.preRollCount + samples.length - this.preRoll.length
      this.preRoll.copyWithin(0, overflow, this.preRollCount)
      this.preRollCount -= overflow
    }
    this.preRoll.set(samples, this.preRollCount)
    this.preRollCount += samples.length
  }

  private appendToUtterance(samples: Float32Array): void {
    if (!samples.length) return
    const room = this.utterance.length - this.utteranceCount
    if (room <= 0) return
    const take = Math.min(room, samples.length)
    this.utterance.set(samples.subarray(0, take), this.utteranceCount)
    this.utteranceCount += take
  }

  private finishUtterance(): void {
    const result = this.utterance.slice(0, this.utteranceCount)
    this.speaking = false
    this.speechMs = 0
    this.silenceMs = 0
    this.loudChunks = 0
    this.utteranceCount = 0
    this.callbacks.onSpeechEnd?.(result)
  }

  /** Throw away the current utterance without emitting it. */
  reset(): void {
    this.speaking = false
    this.speechMs = 0
    this.silenceMs = 0
    this.loudChunks = 0
    this.utteranceCount = 0
    this.preRollCount = 0
  }
}
