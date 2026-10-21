#!/usr/bin/env node
/**
 * Voice diagnostics.
 *
 *   npm run test:voice
 *
 * Exercises every layer of the new voice system without launching the app:
 * the online speech engine, the offline engine, the local recogniser, the
 * wake word matcher and the voice activity detector.
 */
import { createHash, randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const c = {
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  yellow: (s) => `\u001b[33m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}\u001b[0m`,
  cyan: (s) => `\u001b[36m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`
}

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
const WSS_URL = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
const VOICE_LIST_URL =
  `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list` +
  `?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"

let failures = 0

function pass(message) {
  console.log(c.green(`  ✓ ${message}`))
}
function warn(message) {
  console.log(c.yellow(`  ! ${message}`))
}
function fail(message) {
  failures++
  console.log(c.red(`  ✗ ${message}`))
}
function heading(text) {
  console.log(c.bold(c.cyan(`\n▸ ${text}`)))
}

/* ── The online engine ── */

/**
 * Is this a playable audio file?
 *
 * The Edge service prefixes every binary frame with a two-byte header
 * length and a block of headers. If those are not stripped, the "MP3" starts
 * with protocol text and no decoder will accept it — which is exactly the
 * kind of bug that leaves the assistant silent while everything else looks
 * fine.
 */
function looksPlayable(buffer) {
  // A RIFF/WAVE header.
  if (buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF") return "WAV"
  // An MP3 frame starts with eleven sync bits.
  if (buffer.length > 4 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "MP3"
  // An Ogg container.
  if (buffer.length > 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") return "OGG"
  return null
}

function generateSecMsGec() {
  const ticks = Math.floor(Date.now() / 1000) + 11644473600
  const rounded = ticks - (ticks % 300)
  return createHash("sha256")
    .update(`${rounded * 10000000}${TRUSTED_CLIENT_TOKEN}`)
    .digest("hex")
    .toUpperCase()
}

function dateToString() {
  return new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)")
}

function xmlEscape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

async function edgeSynthesize(text, voice = "en-GB-RyanNeural") {
  const { default: WebSocket } = await import("ws")
  const connectionId = randomUUID().replace(/-/g, "")
  const url =
    `${WSS_URL}?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${generateSecMsGec()}&Sec-MS-GEC-Version=1-143.0.3650.96&ConnectionId=${connectionId}`

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
      },
      handshakeTimeout: 15000
    })

    const chunks = []
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      try {
        ws.terminate()
      } catch {}
      if (err) reject(err)
      else resolve(Buffer.concat(chunks))
    }

    const timer = setTimeout(() => finish(new Error("timed out")), 30000)

    ws.on("open", () => {
      ws.send(
        `X-Timestamp:${dateToString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},` +
          `"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
      )
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-GB'>` +
        `<voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`
      ws.send(
        `X-RequestId:${randomUUID().replace(/-/g, "")}\r\nContent-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${dateToString()}Z\r\nPath:ssml\r\n\r\n${ssml}`
      )
    })

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        // The binary frame starts with a two-byte big-endian header length,
        // then the headers, then the audio payload. Everything before the
        // payload has to be stripped or the audio cannot be decoded.
        if (data.length < 2) return
        const headerLength = data.readUInt16BE(0)
        const start = 2 + headerLength
        if (start >= data.length) return
        chunks.push(Buffer.from(data.subarray(start)))
        return
      }
      const text = data.toString()
      if (text.includes("Path:turn.end")) {
        clearTimeout(timer)
        if (!chunks.length) finish(new Error("no audio returned"))
        else finish()
      }
    })

    ws.on("error", (err) => {
      clearTimeout(timer)
      finish(err)
    })
    ws.on("close", () => {
      clearTimeout(timer)
      if (!chunks.length) finish(new Error("closed before sending audio"))
      else finish()
    })
  })
}

/* ── The offline engine ── */

const PIPER_RELEASE = "2023.11.14-2"
const PIPER_VOICE = "en_GB-alan-medium"
const PIPER_VOICE_PATH = "en/en_GB/alan/medium"

function piperArchive() {
  if (process.platform === "win32") {
    return process.arch === "x64" ? "piper_windows_amd64.zip" : null
  }
  if (process.platform === "darwin") {
    return `piper_macos_${process.arch === "arm64" ? "aarch64" : "x64"}.tar.gz`
  }
  if (process.arch === "x64") return "piper_linux_x86_64.tar.gz"
  if (process.arch === "arm64") return "piper_linux_aarch64.tar.gz"
  return null
}

/* ── The local recogniser ── */

async function testWhisper() {
  const { pipeline } = await import("@huggingface/transformers")
  const cache = mkdtempSync(join(tmpdir(), "jarvis-whisper-"))
  process.env.HF_HOME = cache

  const started = Date.now()
  const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
    dtype: "q8",
    device: "cpu"
  })
  pass(`Whisper tiny.en loaded in ${Date.now() - started} ms`)

  // A short tone: the point is the round trip, not the accuracy.
  const rate = 16000
  const samples = new Float32Array(rate)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 220 * i) / rate) * 0.05

  const t = Date.now()
  const out = await asr(samples)
  pass(`Recognised a 1 s sample in ${Date.now() - t} ms → ${JSON.stringify(out)}`)

  rmSync(cache, { recursive: true, force: true })
  return true
}

/* ── The wake word matcher ── */

async function testWakeWord() {
  // Node strips the TypeScript types on the fly, so the shared module can be
  // imported directly — the same code the app uses.
  const { matchWakeWord } = await import("../../src/shared/wake.ts")

  const cases = [
    ["jarvis, what is the time?", "what is the time?"],
    ["Jarvis what is the time", "what is the time"],
    ["hey jarvis open the door", "open the door"],
    ["Hey Jarvis, open the door", "open the door"],
    ["ok jarvis play some music", "play some music"],
    ["jarvus what time is it", "what time is it"],
    ["jervis play some music", "play some music"],
    ["tell me about jarvis", null],
    ["the weather is nice today", null],
    ["hey how are you doing today", null]
  ]

  let ok = true
  for (const [input, expected] of cases) {
    const result = matchWakeWord(input, "Hey jarvis")
    if (expected === null) {
      if (result.matched) {
        fail(`“${input}” should not have matched`)
        ok = false
      }
    } else if (result.command !== expected) {
      fail(`“${input}” → “${result.command}” (expected “${expected}”)`)
      ok = false
    }
  }
  if (ok) pass(`Trigger matching behaves correctly across ${cases.length} cases`)
  return ok
}

/* ── The voice activity detector ── */

async function testVad() {
  const { VoiceActivityDetector } = await import("../../src/renderer/src/audio/vad.ts")

  const rate = 16000
  let ended = null

  const vad = new VoiceActivityDetector(
    { sensitivity: 0.5, silenceMs: 400, preRollMs: 200, sampleRate: rate },
    { onSpeechEnd: (samples) => { ended = samples } }
  )

  // Half a second of room tone, then a second of "speech", then silence.
  for (let i = 0; i < 10; i++) {
    vad.push(new Float32Array(1024).fill(0.002))
  }
  for (let i = 0; i < 25; i++) {
    const chunk = new Float32Array(1024)
    for (let j = 0; j < chunk.length; j++) {
      chunk[j] = Math.sin((2 * Math.PI * 200 * (i * 1024 + j)) / rate) * 0.25
    }
    vad.push(chunk)
  }
  for (let i = 0; i < 40; i++) {
    vad.push(new Float32Array(1024).fill(0.001))
  }

  if (!ended) {
    fail("the detector did not report the end of the utterance")
    return
  }

  const seconds = ended.length / rate
  // The utterance deliberately includes a short pre-roll (so the first
  // phoneme is never clipped) and the trailing silence that ended it.
  if (seconds < 1.4 || seconds > 2.6) {
    fail(`the utterance was ${seconds.toFixed(2)} s long — expected roughly 2.1 s`)
    return
  }
  pass(`the detector segmented a 1.6 s phrase into a ${seconds.toFixed(2)} s utterance`)

  // A second detector must ignore pure room tone.
  const quiet = new VoiceActivityDetector(
    { sensitivity: 0.5, silenceMs: 400, preRollMs: 200, sampleRate: rate },
    { onSpeechEnd: (samples) => { ended = samples } }
  )
  ended = null
  for (let i = 0; i < 60; i++) {
    quiet.push(new Float32Array(1024).fill(0.0015))
  }
  if (ended) {
    fail("the detector reported speech in pure silence")
    return
  }
  pass("the detector ignores room tone")
}

/* ── Main ── */

async function main() {
  console.log(c.bold("\n  JARVIS 2.0 — voice diagnostics\n"))

  heading("Online speech (Edge)")
  try {
    const res = await fetch(VOICE_LIST_URL, { headers: { "User-Agent": USER_AGENT } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const voices = await res.json()
    const british = voices.filter((v) => v.Locale === "en-GB")
    pass(`Voice catalogue reachable — ${voices.length} voices, ${british.length} British ones`)
    if (!voices.some((v) => v.ShortName === "en-GB-RyanNeural")) {
      warn("en-GB-RyanNeural is missing from the catalogue")
    }
  } catch (err) {
    fail(`The voice catalogue is unreachable: ${err.message}`)
  }

  try {
    const started = Date.now()
    const audio = await edgeSynthesize("All systems online. I am JARVIS, at your service.")
    const kind = looksPlayable(audio)
    if (!kind) {
      fail(
        `the audio is not playable — it starts with ${JSON.stringify(audio.subarray(0, 12).toString("latin1"))}`
      )
    } else {
      pass(`Synthesised ${audio.length} bytes of ${kind} in ${Date.now() - started} ms`)
    }
  } catch (err) {
    fail(`Speech synthesis failed: ${err.message}`)
  }

  heading("Offline speech (Piper)")
  const archive = piperArchive()
  if (!archive) {
    warn(`No Piper build exists for ${process.platform} ${process.arch}`)
  } else {
    pass(`A build is available for this platform: ${archive}`)
    console.log(c.dim(`    https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/${archive}`))
    console.log(c.dim(`    voice: https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOICE_PATH}/${PIPER_VOICE}.onnx`))
    console.log(c.dim("    The app downloads both from Settings → Voice.\n"))
  }

  heading("Local recognition (Whisper)")
  try {
    await testWhisper()
  } catch (err) {
    fail(`The local recogniser failed: ${err.message}`)
  }

  heading("Wake word")
  try {
    await testWakeWord()
  } catch (err) {
    fail(`The wake word matcher failed: ${err.message}`)
  }

  heading("Voice activity detection")
  try {
    await testVad()
  } catch (err) {
    fail(`The voice activity detector failed: ${err.message}`)
  }

  console.log()
  if (failures) {
    console.log(c.red(`  ${failures} check(s) failed.\n`))
    process.exit(1)
  }
  console.log(c.green("  Every voice check passed.\n"))
}

main().catch((err) => {
  console.error(c.red(`\nDiagnostics failed: ${err?.message ?? err}\n`))
  process.exit(1)
})
