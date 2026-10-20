import { createHash, randomUUID } from "node:crypto"
import WebSocket from "ws"
import type { VoiceOption } from "@shared/types"
import { createLogger } from "../logger"

const log = createLogger("voice:edge")

/**
 * Microsoft Edge's free "read aloud" speech service.
 *
 * It needs no account and no API key, and it is by far the best sounding
 * option that does not require a local model download — `en-GB-RyanNeural`
 * is remarkably close to the classic JARVIS delivery.
 *
 * The service is protected by a rolling token: the current time is hashed
 * together with a well-known client token and sent as `Sec-MS-GEC`. The
 * digest has to be **uppercase** — the lower-case form is rejected with a
 * 403, which is what several published wrappers get wrong.
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
const WSS_URL = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
const VOICE_LIST_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list" +
  `?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`
const GEC_VERSION = "1-143.0.3650.96"

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"

const WSS_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
}

/** Edge refuses very long single requests — split on word boundaries. */
const MAX_CHARS_PER_REQUEST = 3000

/** The voice JARVIS uses out of the box. */
export const DEFAULT_EDGE_VOICE = "en-GB-RyanNeural"

/* ───────────────────────────  Auth token  ─────────────────────────── */

/** The rolling `Sec-MS-GEC` token. Uppercase hex, exactly as the service expects. */
export function generateSecMsGec(): string {
  const ticks = Math.floor(Date.now() / 1000) + 11644473600
  const rounded = ticks - (ticks % 300)
  return createHash("sha256")
    .update(`${rounded * 10000000}${TRUSTED_CLIENT_TOKEN}`)
    .digest("hex")
    .toUpperCase()
}

function buildUrl(): string {
  const connectionId = randomUUID().replace(/-/g, "")
  return (
    `${WSS_URL}?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${generateSecMsGec()}` +
    `&Sec-MS-GEC-Version=${GEC_VERSION}` +
    `&ConnectionId=${connectionId}`
  )
}

/* ───────────────────────────  Voices  ─────────────────────────── */

interface EdgeVoice {
  ShortName: string
  Name?: string
  Gender?: string
  Locale?: string
  FriendlyName?: string
  StyleList?: string[]
  VoiceTag?: { VoicePersonalities?: string[] }
}

let cachedVoices: VoiceOption[] | null = null
let cachedVoicesAt = 0
let cachedRaw: EdgeVoice[] | null = null

/** Download the voice catalogue. The list is large, so it is cached. */
export async function fetchRawVoices(force = false): Promise<EdgeVoice[]> {
  if (!force && cachedRaw && Date.now() - cachedVoicesAt < 10 * 60_000) return cachedRaw
  try {
    const res = await fetch(VOICE_LIST_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as EdgeVoice[]
    cachedRaw = Array.isArray(data) ? data : []
    cachedVoicesAt = Date.now()
  } catch (err) {
    log.warn("could not download the Edge voice list", String(err))
    // Remember the failure too, so an offline machine does not retry the
    // download on every single request.
    cachedVoicesAt = Date.now()
    return cachedRaw ?? []
  }
  return cachedRaw ?? []
}

/** Voices that sound like a composed British butler. */
const JARVIS_HINTS = ["ryan", "thomas", "george", "oliver", "arthur", "guy", "alan"]

export function toVoiceOptions(raw: EdgeVoice[]): VoiceOption[] {
  return raw
    .filter((v) => v.ShortName && v.Locale)
    .map((v) => {
      const short = v.ShortName
      const name = (v.FriendlyName ?? short).replace(/\s*\(.*?\)\s*$/, "").trim()
      const gender: VoiceOption["gender"] =
        v.Gender === "Male" ? "male" : v.Gender === "Female" ? "female" : "neutral"
      return {
        id: short,
        name,
        language: v.Locale ?? "en-US",
        gender,
        engine: "edge" as const,
        jarvisLike:
          (v.Locale === "en-GB" && gender === "male") ||
          JARVIS_HINTS.some((h) => short.toLowerCase().includes(h)),
        styles: v.StyleList?.length ? v.StyleList : undefined
      }
    })
}

/** Every Edge voice, as the app's voice options. */
export async function listVoices(force = false): Promise<VoiceOption[]> {
  if (!force && cachedVoices && Date.now() - cachedVoicesAt < 10 * 60_000) return cachedVoices
  const raw = await fetchRawVoices(force)
  cachedVoices = toVoiceOptions(raw)
  return cachedVoices
}

/** Does the style exist for this voice? */
export function voiceSupportsStyle(voiceId: string, style: string): boolean {
  if (!style) return false
  const voice = cachedRaw?.find((v) => v.ShortName === voiceId)
  if (!voice?.StyleList?.length) return false
  return voice.StyleList.some((s) => s.toLowerCase() === style.toLowerCase())
}

/**
 * Work out which expressive style to use.
 *
 * The Edge voices can perform a list of named styles. The delivery setting
 * is written in plain English, so the style is looked up in that text —
 * "calm and composed" picks the calm style, "like a newsreader" picks
 * newscast, and so on.
 */
export function inferStyle(voiceId: string, instruction: string): string | undefined {
  if (!instruction) return undefined
  const voice = cachedRaw?.find((v) => v.ShortName === voiceId)
  const styles = voice?.StyleList
  if (!styles?.length) return undefined

  const text = instruction.toLowerCase()
  // The longest style name wins, so "narration-relaxed" is preferred over
  // "narration".
  const matches = styles
    .filter((s) => text.includes(s.toLowerCase().replace(/[-_]/g, " ")) || text.includes(s.toLowerCase()))
    .sort((a, b) => b.length - a.length)

  return matches[0]
}

/* ───────────────────────────  Synthesis  ─────────────────────────── */

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** The service rejects a few control characters. */
function removeIncompatibleCharacters(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
}

function dateToString(): string {
  return new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)")
}

export interface EdgeSynthesisOptions {
  voice: string
  /** 0.5 – 2.0 */
  rate?: number
  /** 0 – 2.0 */
  pitch?: number
  /** 0 – 1.0 */
  volume?: number
  /** Express-as style, e.g. "calm". */
  style?: string
  language?: string
}

function buildSsml(text: string, options: EdgeSynthesisOptions): string {
  const ratePercent = Math.round(((options.rate ?? 1) - 1) * 100)
  const rate = `${ratePercent >= 0 ? "+" : ""}${ratePercent}%`
  const pitchHz = Math.round(((options.pitch ?? 1) - 1) * 20)
  const pitch = `${pitchHz >= 0 ? "+" : ""}${pitchHz}Hz`
  const volumePercent = Math.round(((options.volume ?? 1) - 1) * 100)
  const volume = `${volumePercent >= 0 ? "+" : ""}${volumePercent}%`

  const body = xmlEscape(removeIncompatibleCharacters(text)).replace(/\s+/g, " ").trim()
  const useStyle = options.style && voiceSupportsStyle(options.voice, options.style)

  const prosody = `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${body}</prosody>`

  const voiceInner = useStyle
    ? `<mstts:express-as style='${xmlEscape(options.style!)}' styledegree='2'>${prosody}</mstts:express-as>`
    : prosody

  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis'` +
    ` xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='${xmlEscape(options.language ?? "en-GB")}'>` +
    `<voice name='${xmlEscape(options.voice)}'>${voiceInner}</voice></speak>`
  )
}

/**
 * Split a long utterance into chunks the service will accept.
 *
 * Words are kept whole where possible, but a single word longer than the
 * limit — a pasted log line or a very long URL — is cut rather than
 * rejected by the service.
 */
export function splitForSynthesis(text: string, limit = MAX_CHARS_PER_REQUEST): string[] {
  const clean = text.trim()
  if (!clean) return []
  if (clean.length <= limit) return [clean]

  const chunks: string[] = []
  let current = ""

  for (const word of clean.split(/\s+/)) {
    // A single word that is too long is cut into pieces.
    if (word.length > limit) {
      if (current) {
        chunks.push(current)
        current = ""
      }
      for (let i = 0; i < word.length; i += limit) {
        chunks.push(word.slice(i, i + limit))
      }
      continue
    }

    if (current && current.length + word.length + 1 > limit) {
      chunks.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/** Synthesise a single chunk and resolve with the raw MP3 bytes. */
function synthesizeChunk(ssml: string, timeoutMs = 45_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(buildUrl(), {
      headers: WSS_HEADERS,
      handshakeTimeout: 15_000
    })

    const chunks: Buffer[] = []
    let settled = false
    /** True once the service has confirmed the turn is complete. */
    let completed = false

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      try {
        // The socket is dropped straight away — a graceful close would keep
        // the process alive until the handshake finished.
        ws.terminate()
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else resolve(Buffer.concat(chunks))
    }

    const timer = setTimeout(() => finish(new Error("Edge TTS timed out.")), timeoutMs)

    ws.on("open", () => {
      ws.send(
        `X-Timestamp:${dateToString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},` +
          `"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
      )
      ws.send(
        `X-RequestId:${randomUUID().replace(/-/g, "")}\r\nContent-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${dateToString()}Z\r\nPath:ssml\r\n\r\n${ssml}`
      )
    })

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // A binary frame starts with a two-byte big-endian header length,
        // followed by the headers themselves and then the audio payload.
        // Everything before the payload has to be stripped, or the "MP3"
        // starts with protocol headers and cannot be decoded.
        if (data.length < 2) return
        const headerLength = data.readUInt16BE(0)
        const start = 2 + headerLength
        if (start >= data.length) return
        // The payload is copied, because the socket may reuse its buffer.
        chunks.push(Buffer.from(data.subarray(start)))
        return
      }
      const text = data.toString()
      if (text.includes("Path:turn.end")) {
        clearTimeout(timer)
        completed = true
        if (!chunks.length) finish(new Error("Edge TTS returned no audio."))
        else finish()
        return
      }
      // A refused request is reported as a text frame with an error status.
      if (text.includes("Path:response") && text.includes("Status:4")) {
        clearTimeout(timer)
        finish(new Error(`Edge TTS rejected the request: ${text.slice(0, 200)}`))
      }
    })

    ws.on("error", (err: Error) => {
      clearTimeout(timer)
      finish(err)
    })

    ws.on("close", () => {
      clearTimeout(timer)
      // A socket that dies mid-stream leaves a half-sentence behind. That
      // must not be cached and played as if it were the whole reply.
      if (!completed) {
        finish(new Error("Edge TTS closed before the audio was complete."))
        return
      }
      if (!chunks.length) finish(new Error("Edge TTS closed before sending audio."))
      else finish()
    })
  })
}

/** Synthesise text and return the MP3 bytes. */
export async function synthesize(text: string, options: EdgeSynthesisOptions): Promise<Buffer> {
  const parts = splitForSynthesis(text)
  if (!parts.length) throw new Error("Nothing to say.")
  const buffers: Buffer[] = []

  for (const part of parts) {
    const audio = await synthesizeWithRetry(buildSsml(part, options), options)
    buffers.push(audio)
  }
  return Buffer.concat(buffers)
}

/**
 * Synthesise one chunk, retrying when the service is busy.
 *
 * The Edge service throttles with a 429 when it has been hammered. Waiting
 * a moment and trying again is far better than falling back to a much
 * worse voice, so the request is retried a couple of times.
 */
async function synthesizeWithRetry(ssml: string, options: EdgeSynthesisOptions): Promise<Buffer> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await synthesizeChunk(ssml)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (!/429|too many requests/i.test(lastError.message)) break
      const wait = 1200 * (attempt + 1)
      log.warn(`the Edge service is busy — retrying in ${wait} ms`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }

  throw lastError ?? new Error("Edge TTS failed.")
}

/**
 * Quick reachability probe — used by the setup wizard.
 *
 * The voice catalogue doubles as the probe, and it is cached, so the
 * download is not repeated for every status check.
 */
export async function probe(): Promise<boolean> {
  const voices = await fetchRawVoices()
  if (voices.length) return true

  // The catalogue may simply be empty; ask the service directly.
  try {
    const res = await fetch(VOICE_LIST_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000)
    })
    return res.ok
  } catch {
    return false
  }
}
