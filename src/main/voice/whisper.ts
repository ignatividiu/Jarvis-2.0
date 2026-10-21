import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers"
import type { SpeechModelStatus, SttEngine } from "@shared/types"
import { createLogger } from "../logger"

const log = createLogger("voice:whisper")

/**
 * Local speech recognition with OpenAI Whisper, running through
 * transformers.js on the ONNX runtime.
 *
 * Everything happens on this machine: the audio never leaves it, no API key
 * is needed, and the model is downloaded once and then cached. A `tiny`
 * model recognises a short phrase in roughly 150 ms on a modern laptop, which
 * is fast enough to detect a wake word in real time.
 */

export interface SpeechModel {
  id: string
  label: string
  sizeBytes: number
  description: string
  /** True for the English-only models. */
  englishOnly?: boolean
  recommended?: boolean
}

/** The recognition models JARVIS can use. */
export const SPEECH_MODELS: SpeechModel[] = [
  {
    id: "onnx-community/whisper-tiny.en",
    label: "Whisper Tiny (English)",
    sizeBytes: 42_000_000,
    description: "Fastest and smallest. Ideal for the wake word and short commands.",
    englishOnly: true,
    recommended: true
  },
  {
    id: "onnx-community/whisper-base",
    label: "Whisper Base",
    sizeBytes: 80_000_000,
    description: "A good balance of speed and accuracy. Handles accents and other languages.",
    recommended: true
  },
  {
    id: "onnx-community/whisper-small",
    label: "Whisper Small",
    sizeBytes: 250_000_000,
    description: "Noticeably more accurate on names and unusual vocabulary."
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo",
    sizeBytes: 900_000_000,
    description: "Best accuracy available offline. Needs about 2 GB of memory."
  }
]

const DEFAULT_MODEL = "onnx-community/whisper-base"

let cacheDir = ""
let loaded: AutomaticSpeechRecognitionPipeline | null = null
let loadedId = ""
/** The loads that are currently in flight, keyed by model id. */
const loading = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>()
let downloadProgress = 0
let downloading = false

export function configureWhisper(baseDir: string): void {
  cacheDir = join(baseDir, "models")
  try {
    mkdirSync(cacheDir, { recursive: true })
    env.cacheDir = cacheDir
  } catch (err) {
    log.warn("could not create the model cache", String(err))
  }
}

/**
 * The on-disk folder for a model.
 *
 * transformers.js mirrors the repository path, so `onnx-community/whisper-tiny.en`
 * is stored as `<cache>/onnx-community/whisper-tiny.en`.
 */
function modelFolder(modelId: string): string {
  return join(cacheDir, modelId)
}

export function isModelInstalled(modelId: string): boolean {
  if (!cacheDir) return false
  return existsSync(modelFolder(modelId))
}

export function modelStatus(): SpeechModelStatus[] {
  return SPEECH_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    sizeBytes: m.sizeBytes,
    installed: isModelInstalled(m.id),
    downloading: downloading && loadedId === m.id,
    progress: loadedId === m.id ? downloadProgress : 0,
    description: m.description
  }))
}

/**
 * Load the recognition model, downloading it on first use.
 *
 * The download reports progress so the setup wizard can show a bar.
 */
export async function loadModel(
  modelId = DEFAULT_MODEL,
  onProgress?: (percent: number, message: string) => void
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (loaded && loadedId === modelId) return loaded

  // A load that is already running for this model is joined rather than
  // started again — two ONNX sessions for the same weights would double the
  // memory use for no benefit.
  const inFlight = loading.get(modelId)
  if (inFlight) return inFlight

  downloading = true
  downloadProgress = 0

  const files = new Map<string, { loaded: number; total: number }>()

  const task = (async () => {
    try {
      const asr = (await pipeline("automatic-speech-recognition", modelId, {
        dtype: "q8",
        device: "cpu",
        progress_callback: (info: unknown) => {
          const p = info as { status?: string; file?: string; loaded?: number; total?: number; progress?: number }
          if (p.status === "progress" && p.file && typeof p.total === "number" && p.total > 0) {
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
            let loadedBytes = 0
            let totalBytes = 0
            for (const f of files.values()) {
              loadedBytes += f.loaded
              totalBytes += f.total
            }
            downloadProgress = totalBytes ? Math.round((loadedBytes / totalBytes) * 100) : 0
            onProgress?.(downloadProgress, `Downloading the speech model — ${downloadProgress}%`)
          } else if (p.status === "ready" || p.status === "done") {
            onProgress?.(100, "The speech model is ready.")
          }
        }
      })) as AutomaticSpeechRecognitionPipeline

      // Only become the active model if nothing else was requested in the
      // meantime — a slower load must not overwrite a newer one.
      if (!loaded || loadedId === modelId) {
        loaded = asr
        loadedId = modelId
      }
      downloading = false
      downloadProgress = 100
      return asr
    } catch (err) {
      downloading = false
      log.warn(`could not load the speech model ${modelId}`, String(err))
      throw err
    } finally {
      loading.delete(modelId)
    }
  })()

  loading.set(modelId, task)
  return task
}

/** Warm the model up without transcribing anything. */
export async function prepareModel(
  modelId = DEFAULT_MODEL,
  onProgress?: (percent: number, message: string) => void
): Promise<{ ok: boolean; message: string }> {
  try {
    await loadModel(modelId, onProgress)
    return { ok: true, message: "The speech model is ready." }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export interface TranscribeOptions {
  language?: string
  /** Force a specific model. */
  modelId?: string
}

/**
 * Recognise speech in a mono 16 kHz buffer.
 *
 * Whisper expects 16 kHz audio, which is exactly what the renderer captures.
 */
export async function transcribe(
  samples: Float32Array,
  options: TranscribeOptions = {}
): Promise<{ text: string; durationMs: number; model: string }> {
  if (!samples?.length) return { text: "", durationMs: 0, model: loadedId }

  const modelId = options.modelId || loadedId || DEFAULT_MODEL
  const asr = await loadModel(modelId)

  const isEnglishOnly = SPEECH_MODELS.find((m) => m.id === modelId)?.englishOnly ?? false
  const language = options.language && options.language !== "auto" ? options.language : undefined

  const started = Date.now()
  const output = (await asr(samples, {
    // English-only models refuse these options.
    ...(isEnglishOnly ? {} : { language: language ?? "en", task: "transcribe" as const })
  })) as { text?: string } | string

  const text = typeof output === "string" ? output : (output?.text ?? "")
  return { text: text.trim(), durationMs: Date.now() - started, model: modelId }
}

/** Free the loaded model. */
export function unload(): void {
  loaded = null
  loading.clear()
  loadedId = ""
}

export function currentModel(): string {
  return loadedId
}
