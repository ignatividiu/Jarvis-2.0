import { randomUUID } from "node:crypto"
import type {
  SpeakRequest,
  SpeakResult,
  SpeechModelStatus,
  SttEngine,
  TranscribeRequest,
  TranscribeResult,
  TtsEngine,
  VoiceOption,
  VoiceStatus
} from "@shared/types"
import { config } from "../store"
import { createLogger } from "../logger"
import * as edge from "./edge"
import * as piper from "./piper"
import * as whisper from "./whisper"

const log = createLogger("voice")

/**
 * The voice facade.
 *
 * JARVIS 2.0 dropped the external Voicebox application entirely. Instead it
 * talks to three speech engines that it can install and control itself:
 *
 *  1. **Edge** — Microsoft's free read-aloud service. No account, no key, the
 *     best sounding voices, but it needs an internet connection.
 *  2. **Piper** — a small offline engine that JARVIS downloads on demand.
 *     Works with no internet at all.
 *  3. **Browser** — the operating system's own speech synthesis. Always
 *     available, and the last line of defence.
 *
 * Recognition works the same way: a **local Whisper** model does the heavy
 * lifting, and the browser's own recogniser is the fallback.
 */

/* ───────────────────────────  Clip cache  ─────────────────────────── */

interface Clip {
  buffer: Buffer
  mimeType: string
  createdAt: number
}

const clips = new Map<string, Clip>()
const MAX_CLIPS = 12

/** Store generated audio so the renderer can stream it back through the media protocol. */
export function storeClip(buffer: Buffer, mimeType: string): string {
  const id = randomUUID()
  clips.set(id, { buffer, mimeType, createdAt: Date.now() })

  // Keep the cache small — old clips are never fetched again.
  if (clips.size > MAX_CLIPS) {
    const oldest = [...clips.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
    if (oldest) clips.delete(oldest[0])
  }
  return id
}

export function getClip(id: string): Clip | undefined {
  return clips.get(id)
}

/* ───────────────────────────  Engine selection  ─────────────────────────── */

/** Is the Edge service reachable right now? */
let edgeReachable: boolean | null = null
let edgeProbedAt = 0

export async function isEdgeReachable(force = false): Promise<boolean> {
  if (!force && edgeReachable !== null && Date.now() - edgeProbedAt < 60_000) return edgeReachable
  edgeReachable = await edge.probe()
  edgeProbedAt = Date.now()
  return edgeReachable
}

/** Work out which synthesis engine should run. */
export async function resolveTtsEngine(force = false): Promise<TtsEngine> {
  const configured = config.get().voice.engine
  if (configured !== "auto") return configured

  if (await isEdgeReachable(force)) return "edge"
  if (piper.isBinaryPresent() && piper.installedVoiceIds().length) return "piper"
  return "browser"
}

/** Work out which recognition engine should run. */
export async function resolveSttEngine(): Promise<SttEngine> {
  const configured = config.get().voice.sttEngine
  if (configured !== "auto") return configured
  return "whisper"
}

/* ───────────────────────────  Voices  ─────────────────────────── */

/** Every voice the user can choose, across all engines. */
export async function listVoices(): Promise<VoiceOption[]> {
  const edgeVoices = await edge.listVoices()
  const piperVoices = piper.listVoices()
  return [...edgeVoices, ...piperVoices]
}

/** Find a voice by id across every engine. */
export async function findVoice(voiceId: string): Promise<VoiceOption | null> {
  if (!voiceId) return null
  const voices = await listVoices()
  return voices.find((v) => v.id === voiceId) ?? null
}

/* ───────────────────────────  Status  ─────────────────────────── */

export async function voiceStatus(): Promise<VoiceStatus> {
  const cfg = config.get()
  const [edgeOk, voices] = await Promise.all([isEdgeReachable(), listVoices()])

  const activeEngine = await resolveTtsEngine()
  const activeSttEngine = await resolveSttEngine()
  const active = voices.find((v) => v.id === cfg.voice.voiceId) ?? null

  const models = whisper.modelStatus()
  const whisperReady = models.some((m) => m.installed)

  const summaryParts: string[] = []
  if (activeEngine === "edge") summaryParts.push("Edge TTS (online)")
  else if (activeEngine === "piper") summaryParts.push("Piper (offline)")
  else summaryParts.push("System voice")
  summaryParts.push(activeSttEngine === "whisper" ? "local Whisper" : "browser recogniser")

  // The message has to match what is actually going to happen.
  let error: string | undefined
  if (!edgeOk) {
    error =
      activeEngine === "piper"
        ? "The online voice service could not be reached — the offline engine is being used instead."
        : activeEngine === "browser"
          ? "The online voice service could not be reached — the system voice is being used instead."
          : "The online voice service could not be reached."
  }

  return {
    activeEngine,
    activeSttEngine,
    voices,
    models,
    piperInstalled: piper.isBinaryPresent(),
    piperBinaryPresent: piper.isBinaryPresent(),
    edgeReachable: edgeOk,
    whisperReady,
    whisperModel: whisper.currentModel() || cfg.voice.sttModel,
    activeVoiceId: active?.id ?? cfg.voice.voiceId,
    activeVoiceName: active?.name ?? "System default",
    summary: summaryParts.join(" → "),
    error
  }
}

/* ───────────────────────────  Speaking  ─────────────────────────── */

export interface SpeakOptions {
  /** Force a particular engine. */
  engine?: TtsEngine
}

/**
 * Speak a reply and return a playable clip.
 *
 * When the engine is the browser's own speech synthesis there is no audio to
 * return — the renderer speaks it locally instead.
 */
export async function speak(request: SpeakRequest, options: SpeakOptions = {}): Promise<SpeakResult> {
  const cfg = config.get()
  const text = (request.text ?? "").trim()
  if (!text) return { ok: false, engine: "browser", error: "Nothing to say." }

  const engine = options.engine ?? (await resolveTtsEngine())

  if (engine === "browser") {
    return { ok: true, engine: "browser" }
  }

  const started = Date.now()
  const voiceId = request.voiceId || cfg.voice.voiceId

  try {
    if (engine === "edge") {
      // The reachability check comes first: looking the voice up needs the
      // catalogue, which is a network request of its own.
      const reachable = await isEdgeReachable()
      if (!reachable) {
        return {
          ok: false,
          engine: "edge",
          error: "The online voice service is not reachable. Turn on the offline voice engine in Settings → Voice."
        }
      }

      const voice = await findVoice(voiceId)
      const edgeVoice = voice?.engine === "edge" ? voice.id : edge.DEFAULT_EDGE_VOICE

      // The delivery instruction is written in plain English, so the
      // expressive style is looked up inside it.
      const instruction = request.instruct ?? cfg.voice.instruct
      const style = request.style || cfg.voice.style || edge.inferStyle(edgeVoice, instruction)

      const audio = await edge.synthesize(text, {
        voice: edgeVoice,
        rate: cfg.voice.rate,
        pitch: cfg.voice.pitch,
        volume: cfg.voice.volume,
        style,
        language: request.language || cfg.voice.language
      })

      const clipId = storeClip(audio, "audio/mpeg")
      return {
        ok: true,
        engine: "edge",
        clipId,
        mimeType: "audio/mpeg",
        bytes: audio.length,
        durationMs: Date.now() - started
      }
    }

    const voice = await findVoice(voiceId)

    if (engine === "piper") {
      const piperVoice = voice?.engine === "piper" ? voice.id : piper.installedVoiceIds()[0]
      if (!piperVoice) {
        return {
          ok: false,
          engine: "piper",
          error: "The offline voice engine has no voice installed. Download one in Settings → Voice."
        }
      }
      const audio = await piper.synthesize(text, piperVoice, { rate: cfg.voice.rate })
      const clipId = storeClip(audio, "audio/wav")
      return {
        ok: true,
        engine: "piper",
        clipId,
        mimeType: "audio/wav",
        bytes: audio.length,
        durationMs: Date.now() - started
      }
    }

    return { ok: true, engine: "browser" }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn("speech synthesis failed", message)

    // Fall back to the browser engine so the reply is still spoken.
    return { ok: true, engine: "browser", error: message }
  }
}

/* ───────────────────────────  Listening  ─────────────────────────── */

/** Recognise speech from a 16 kHz mono buffer. */
export async function transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
  const cfg = config.get()
  const started = Date.now()

  if (!request?.samples?.length) {
    return { ok: false, text: "", engine: "whisper", error: "No audio was captured." }
  }

  const engine = request.engine ?? (await resolveSttEngine())

  if (engine === "whisper") {
    try {
      const result = await whisper.transcribe(request.samples, {
        language: request.language || cfg.voice.language,
        modelId: cfg.voice.sttModel
      })
      return {
        ok: true,
        text: result.text,
        engine: "whisper",
        durationMs: Date.now() - started
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn("transcription failed", message)
      return { ok: false, text: "", engine: "whisper", error: message, durationMs: Date.now() - started }
    }
  }

  // The browser recogniser runs in the renderer, so there is nothing to do here.
  return {
    ok: false,
    text: "",
    engine: "browser",
    error: "The browser recogniser handles this in the window."
  }
}

/* ───────────────────────────  Setup helpers  ─────────────────────────── */

/** Download a speech recognition model. */
export async function downloadSpeechModel(
  modelId: string,
  onProgress?: (percent: number, message: string) => void
): Promise<{ ok: boolean; message: string }> {
  return whisper.prepareModel(modelId, onProgress)
}

/** Download the offline speech engine and a voice. */
export async function installOfflineVoice(
  voiceId: string,
  onProgress?: (percent: number, message: string, bytes?: { total: number; received: number }) => void
): Promise<{ ok: boolean; message: string }> {
  const result = await piper.installPiper(voiceId, onProgress)
  if (result.ok) piper.markInstalled()
  return result
}

export function removeOfflineVoice(): { ok: boolean; message: string } {
  return piper.uninstallPiper()
}

export function speechModels(): SpeechModelStatus[] {
  return whisper.modelStatus()
}

export { edge, piper, whisper }
