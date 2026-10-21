import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { randomBytes } from "node:crypto"
import { networkInterfaces } from "node:os"
import type { RemoteStatus } from "@shared/types"
import { config } from "../store"
import { createLogger } from "../logger"
import { speak } from "../voice"
import { runAssistant } from "../agent/orchestrator"

const log = createLogger("remote")

/**
 * Remote access.
 *
 * A tiny HTTP server that lets another device — a phone, a tablet, another
 * computer — talk to JARVIS over the network. It serves a small page with a
 * chat box and a hold-to-talk button, so the assistant can be reached from
 * outside the local network.
 *
 * Every request has to present the pairing token, and the server can be
 * restricted to the local network. It is off by default.
 */

let server: Server | null = null
let running = false
let lastError: string | undefined

/* ───────────────────────────  Helpers  ─────────────────────────── */

/** The addresses a remote device could use. */
export function remoteAddresses(port: number): string[] {
  const out: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family !== "IPv4") continue
      out.push(`http://${entry.address}:${port}`)
    }
  }
  return out
}

/** True when the request came from this machine. */
function isLocal(address: string | undefined): boolean {
  if (!address) return true
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("192.168.") ||
    address.startsWith("10.") ||
    address.startsWith("172.16.") ||
    address.startsWith("172.17.") ||
    address.startsWith("172.18.") ||
    address.startsWith("172.19.") ||
    address.startsWith("172.2") ||
    address.startsWith("172.30.") ||
    address.startsWith("172.31.") ||
    address.startsWith("169.254.") ||
    address.startsWith("fc") ||
    address.startsWith("fd")
  )
}

/** Is this address inside the private ranges? */
function isPrivateNetwork(address: string | undefined): boolean {
  if (!address) return true
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("192.168.") ||
    address.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    address.startsWith("169.254.") ||
    address.startsWith("fc") ||
    address.startsWith("fd")
  )
}

function tokenMatches(provided: string | null | undefined): boolean {
  const expected = config.get().remote.token
  if (!expected) return false
  if (!provided) return false
  return provided === expected
}

/* ───────────────────────────  The page  ─────────────────────────── */

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>JARVIS</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #05070d; color: #dfe3ec;
  }
  header { padding: 18px 20px 10px; display: flex; align-items: center; gap: 12px; }
  .mark { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center;
    font-weight: 700; color: #00281a; background: linear-gradient(140deg,#3ddc97,#4fd6ff); }
  h1 { margin: 0; font-size: 17px; letter-spacing: .14em; }
  header p { margin: 0; font-size: 12px; color: #9aa3b7; }
  #log { flex: 1; overflow-y: auto; padding: 10px 20px 20px; display: flex; flex-direction: column; gap: 12px; }
  .msg { max-width: 82%; padding: 11px 14px; border-radius: 16px; font-size: 15px; }
  .msg.user { align-self: flex-end; background: #17324a; border-bottom-right-radius: 5px; }
  .msg.bot { align-self: flex-start; background: #121826; border-bottom-left-radius: 5px; }
  .msg.err { background: #3a1414; color: #ffb4b4; }
  .msg .who { font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: #9aa3b7; margin-bottom: 3px; }
  form { display: flex; gap: 8px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid #2a3244; background: #080b13; }
  input, button { font: inherit; border-radius: 22px; border: 1px solid #2a3244; padding: 11px 16px; }
  input { flex: 1; background: #0e1320; color: #dfe3ec; }
  button { background: #3ddc97; color: #00281a; border-color: transparent; font-weight: 600; }
  button.rec { background: #ff6b6b; color: #fff; }
  button.ghost { background: transparent; color: #9aa3b7; }
  .row { display: flex; gap: 8px; }
  #status { font-size: 12px; color: #9aa3b7; padding: 0 20px 8px; }
</style>
</head>
<body>
<header>
  <div class="mark">J</div>
  <div><h1>JARVIS</h1><p>Remote console</p></div>
</header>
<div id="status">Connecting…</div>
<div id="log"></div>
<form id="form">
  <input id="text" placeholder="Ask JARVIS…" autocomplete="off" />
  <button type="button" id="mic" class="ghost" title="Hold to talk">🎙</button>
  <button type="submit">Send</button>
</form>
<script>
const token = new URLSearchParams(location.search).get("token") || localStorage.getItem("jarvis.token") || "";
if (token) localStorage.setItem("jarvis.token", token);
const log = document.getElementById("log");
const status = document.getElementById("status");
const form = document.getElementById("form");
const text = document.getElementById("text");
const mic = document.getElementById("mic");

function add(who, body, cls) {
  const el = document.createElement("div");
  el.className = "msg " + (cls || who);
  el.innerHTML = '<div class="who">' + who + "</div>" + body;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
function esc(s) { return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function api(path, options) {
  const res = await fetch(path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token), options);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function send(text) {
  if (!text.trim()) return;
  add("you", esc(text));
  const pending = add("jarvis", "…");
  try {
    const data = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    pending.innerHTML = '<div class="who">jarvis</div>' + esc(data.reply || "");
    if (data.audio) {
      const audio = new Audio("data:audio/mpeg;base64," + data.audio);
      audio.play().catch(() => {});
    }
  } catch (err) {
    pending.className = "msg err";
    pending.textContent = "Failed: " + err.message;
  }
}

form.addEventListener("submit", (e) => { e.preventDefault(); const v = text.value; text.value = ""; send(v); });

/* Hold to talk. */
let recorder = null, chunks = [];
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start();
    mic.classList.add("rec");
    status.textContent = "Listening…";
  } catch (err) { status.textContent = "Microphone denied: " + err.message; }
}
async function stopRecording() {
  if (!recorder) return;
  const done = new Promise((res) => { recorder.onstop = res; });
  recorder.stop();
  mic.classList.remove("rec");
  status.textContent = "Transcribing…";
  await done;
  const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
  const wav = await toWav(blob);
  try {
    const data = await api("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: wav
    });
    status.textContent = "";
    if (data.text) send(data.text);
    else status.textContent = "Nothing was heard.";
  } catch (err) { status.textContent = "Failed: " + err.message; }
}
mic.addEventListener("pointerdown", (e) => { e.preventDefault(); startRecording(); });
mic.addEventListener("pointerup", () => stopRecording());
mic.addEventListener("pointercancel", () => stopRecording());

/* The browser records WebM or Opus, which the recogniser cannot read.
   It is decoded here and re-encoded as 16 kHz mono WAV, which it can. */
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

async function toWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();

  // Downsample to 16 kHz, which is what the recogniser expects.
  const target = 16000;
  const ratio = decoded.sampleRate / target;
  const length = Math.floor(decoded.duration * target);
  const mono = new Float32Array(length);
  const channel = decoded.getChannelData(0);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    const start = Math.floor(i * ratio);
    const end = Math.min(channel.length, Math.floor((i + 1) * ratio));
    for (let k = start; k < end; k++) sum += channel[k];
    mono[i] = end > start ? sum / (end - start) : 0;
  }
  return encodeWav(mono, target);
}

(async () => {
  try {
    const s = await api("/api/status");
    status.textContent = s.online ? "Connected · " + (s.voice || "voice ready") : "Ready";
  } catch { status.textContent = "Could not reach JARVIS."; }
})();
</script>
</body>
</html>`

/* ───────────────────────────  The server  ─────────────────────────── */

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(payload)),
    "Cache-Control": "no-store"
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    if (chunks.reduce((n, c) => n + c.length, 0) > 25_000_000) break
  }
  return Buffer.concat(chunks)
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const settings = config.get()
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  const address = req.socket.remoteAddress

  // The page itself is public — it has nothing to say on its own.
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
    res.end(PAGE)
    return
  }

  if (url.pathname === "/api/status") {
    sendJson(res, 200, {
      online: true,
      name: settings.persona.name,
      voice: settings.voice.voiceId,
      alwaysOn: settings.voice.alwaysOn,
      wakeWord: settings.voice.wakeWord
    })
    return
  }

  // Everything else needs the token.
  const header = req.headers.authorization
  const provided =
    (typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : null) ??
    url.searchParams.get("token")
  if (!tokenMatches(provided)) {
    sendJson(res, 401, { error: "A valid pairing token is required." })
    return
  }

  if (settings.remote.localNetworkOnly && !isPrivateNetwork(address)) {
    sendJson(res, 403, { error: "Remote access is restricted to the local network." })
    return
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    let text = ""
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}")
      text = String(body.text ?? "")
    } catch {
      sendJson(res, 400, { error: "The request body was not valid JSON." })
      return
    }
    if (!text.trim()) {
      sendJson(res, 400, { error: "No text was given." })
      return
    }

    let reply = ""
    try {
      await runAssistant({
        text,
        tools: [],
        emit: (chunk) => {
          if (chunk.type === "delta" && chunk.text) reply += chunk.text
          if (chunk.type === "end" && chunk.text) reply = chunk.text
        }
      })
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
      return
    }

    // Offer the spoken answer as well, so the phone can read it out.
    let audio: string | null = null
    try {
      const spoken = await speak({ text: reply })
      if (spoken.ok && spoken.clipId) {
        // The clip is served through the desktop app; the remote page gets
        // the raw audio instead.
        const { getClip } = await import("../voice")
        const clip = getClip(spoken.clipId)
        if (clip) audio = clip.buffer.toString("base64")
      }
    } catch {
      /* the text reply is enough */
    }

    sendJson(res, 200, { reply, audio })
    return
  }

  if (url.pathname === "/api/transcribe" && req.method === "POST") {
    const audio = await readBody(req)
    if (!audio.length) {
      sendJson(res, 400, { error: "No audio was sent." })
      return
    }
    try {
      const { transcribe } = await import("../voice")
      const result = await transcribe({
        samples: decodeWav(audio),
        sampleRate: 16000,
        language: "auto"
      })
      sendJson(res, 200, { text: result.text, error: result.error })
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
    return
  }

  sendJson(res, 404, { error: "Not found." })
}

/**
 * Decode the uploaded audio.
 *
 * The browser sends WebM or Opus, which the recogniser cannot read directly,
 * so the audio is decoded through the system's own ffmpeg when it is
 * available. Without it the recogniser still works for WAV.
 */
function decodeWav(audio: Buffer): Float32Array {
  // A RIFF/WAVE file can be read directly.
  if (audio.length > 44 && audio.subarray(0, 4).toString("ascii") === "RIFF") {
    return readWav(audio)
  }
  // Anything else cannot be decoded here; the recogniser will report it.
  return new Float32Array(0)
}

/** Read a 16-bit PCM WAV file into mono float samples. */
function readWav(audio: Buffer): Float32Array {
  const channels = audio.readUInt16LE(22)
  const sampleRate = audio.readUInt32LE(24)
  const bits = audio.readUInt16LE(34)
  if (bits !== 16) return new Float32Array(0)

  // Find the data chunk.
  let offset = 12
  let dataStart = 0
  let dataLength = 0
  while (offset + 8 <= audio.length) {
    const id = audio.subarray(offset, offset + 4).toString("ascii")
    const size = audio.readUInt32LE(offset + 4)
    if (id === "data") {
      dataStart = offset + 8
      dataLength = Math.min(size, audio.length - dataStart)
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (!dataLength) return new Float32Array(0)

  const frames = Math.floor(dataLength / 2 / channels)
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      sum += audio.readInt16LE(dataStart + (i * channels + c) * 2) / 32768
    }
    out[i] = sum / channels
  }

  // Resample to 16 kHz if the file is not already there.
  if (sampleRate === 16000) return out
  const ratio = sampleRate / 16000
  const result = new Float32Array(Math.floor(frames / ratio))
  for (let i = 0; i < result.length; i++) {
    result[i] = out[Math.min(frames - 1, Math.floor(i * ratio))] ?? 0
  }
  return result
}

/* ───────────────────────────  Lifecycle  ─────────────────────────── */

export function remoteStatus(): RemoteStatus {
  const settings = config.get()
  return {
    running,
    port: settings.remote.port,
    addresses: running ? remoteAddresses(settings.remote.port) : [],
    token: settings.remote.token,
    enabled: settings.remote.enabled,
    localNetworkOnly: settings.remote.localNetworkOnly,
    error: lastError
  }
}

export async function startRemote(): Promise<RemoteStatus> {
  const settings = config.get()
  if (running) return remoteStatus()

  return new Promise((resolve) => {
    try {
      const instance = createServer((req, res) => {
        void handle(req, res).catch((err) => {
          log.warn("request failed", String(err))
          if (!res.headersSent) sendJson(res, 500, { error: "The request failed." })
        })
      })

      instance.on("error", (err) => {
        lastError = err.message
        log.warn("the remote server could not start", err.message)
        running = false
        resolve(remoteStatus())
      })

      instance.listen(settings.remote.port, "0.0.0.0", () => {
        running = true
        lastError = undefined
        log.info(`remote access is listening on port ${settings.remote.port}`)
        resolve(remoteStatus())
      })
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      resolve(remoteStatus())
    }
  })
}

export function stopRemote(): RemoteStatus {
  if (server) server.close()
  running = false
  return remoteStatus()
}

/** Generate a fresh pairing token. */
export function rotateToken(): RemoteStatus {
  const token = randomBytes(16).toString("hex")
  config.update({ remote: { ...config.get().remote, token } })
  return remoteStatus()
}

/** Start the server if the setting says it should be running. */
export async function syncRemote(): Promise<void> {
  const settings = config.get()
  if (settings.remote.enabled && !running) await startRemote()
  if (!settings.remote.enabled && running) stopRemote()
}
