import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { SetupProgress } from "@shared/types"
import { createLogger } from "../logger"
import { downloadFile, fileSize, which } from "../net"

const log = createLogger("ollama")

/**
 * The local model runtime.
 *
 * Ollama is the easiest way to run a model entirely on the user's own
 * machine. It is downloaded into the app's own folder — no administrator
 * rights, no system-wide install — and started as a child process.
 */

export const OLLAMA_BASE = "http://127.0.0.1:11434"

/** Where the portable runtime is unpacked. */
let installDir = ""

export function configureOllama(baseDir: string): void {
  installDir = join(baseDir, "ollama")
}

function binaryName(): string {
  return process.platform === "win32" ? "ollama.exe" : "ollama"
}

/** The downloaded runtime, if the app installed one. */
export function findOllamaBinary(): string | null {
  if (installDir && existsSync(installDir)) {
    const found = findBinary(installDir)
    if (found) return found
  }
  return null
}

/**
 * A runtime installed on the system, outside the app.
 *
 * It is only ever *detected*, never managed: the app does not start it and
 * does not stop it, because it belongs to the user.
 */
export function findSystemOllama(): string | null {
  return which("ollama")
}

/** Look for the executable inside the unpacked archive. */
function findBinary(dir: string): string | null {
  const exe = binaryName()
  const direct = join(dir, exe)
  if (existsSync(direct)) return direct

  for (const sub of ["bin", "ollama"]) {
    const candidate = join(dir, sub, exe)
    if (existsSync(candidate)) return candidate
  }

  // The archive nests the files one level deep.
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const nested = findBinary(join(dir, entry.name))
      if (nested) return nested
    }
  } catch {
    /* not readable */
  }
  return null
}

/** Is the Ollama server answering? */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/** The version of the running runtime. */
export async function ollamaVersion(): Promise<string | undefined> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/version`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return undefined
    const data = (await res.json()) as { version?: string }
    return data.version
  } catch {
    return undefined
  }
}

/* ──────────────────────────  Installer  ────────────────────────── */

function downloadUrl(): string | null {
  const arch = process.arch
  if (process.platform === "win32") {
    if (arch !== "x64") return null
    return "https://ollama.com/download/ollama-windows-amd64.zip"
  }
  if (process.platform === "darwin") {
    return "https://ollama.com/download/Ollama-darwin.zip"
  }
  if (arch === "x64") return "https://ollama.com/download/ollama-linux-amd64.tgz"
  if (arch === "arm64") return "https://ollama.com/download/ollama-linux-arm64.tgz"
  return null
}

/** Unpack an archive with the system `tar`. */
async function extractArchive(archive: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xf", archive, "-C", destination], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    })
    let stderr = ""
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString()
    })
    child.on("error", (err) => reject(new Error(`Could not run tar: ${err.message}`)))
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar exited with ${code}: ${stderr.slice(0, 300)}`))
    })
  })
}

/**
 * Download and unpack the runtime.
 *
 * The progress callback receives the same shape as the rest of the setup
 * wizard, so the bar looks the same for every component.
 */
export async function installOllama(
  onProgress?: (p: SetupProgress) => void
): Promise<{ ok: boolean; message: string }> {
  if (!installDir) {
    return { ok: false, message: "The local runtime has not been initialised yet." }
  }

  const url = downloadUrl()
  if (!url) {
    return {
      ok: false,
      message: `Ollama does not publish a build for ${process.platform} ${process.arch}. Install it manually and JARVIS will use it.`
    }
  }

  try {
    mkdirSync(installDir, { recursive: true })
    const name = url.split("/").pop() ?? "ollama.zip"
    const archive = join(installDir, name)

    onProgress?.({
      stage: "downloading",
      component: "ollama",
      percent: 0,
      message: "Downloading the local model runtime…"
    })

    await downloadFile(url, archive, (p) => {
      onProgress?.({
        stage: "downloading",
        component: "ollama",
        percent: Math.min(85, Math.round(p.percent * 0.85)),
        message: `Downloading the local model runtime — ${p.percent}%`,
        bytes: { total: p.total, received: p.received }
      })
    })

    onProgress?.({
      stage: "installing",
      component: "ollama",
      percent: 88,
      message: "Unpacking the local model runtime…"
    })
    await extractArchive(archive, installDir)
    rmSync(archive, { force: true })

    if (!findOllamaBinary()) {
      return { ok: false, message: "The runtime was unpacked but the executable is missing." }
    }

    onProgress?.({
      stage: "done",
      component: "ollama",
      percent: 95,
      message: "The local model runtime is ready."
    })
    return { ok: true, message: "The local model runtime is ready." }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("the local runtime could not be installed", message)
    onProgress?.({
      stage: "error",
      component: "ollama",
      percent: 0,
      message: "The local model runtime could not be installed",
      error: message
    })
    return { ok: false, message }
  }
}

/* ──────────────────────────  Server  ────────────────────────── */

let server: ChildProcess | null = null
/** True when the running server was started by this app. */
let ownsServer = false

/**
 * Start the runtime, unless it is already running.
 *
 * The server is detached so it can outlive the app — a model that has to be
 * reloaded every time JARVIS restarts is a poor experience. A runtime the
 * app did not start is never stopped by the app.
 */
export async function startOllamaServer(): Promise<{ ok: boolean; message: string }> {
  if (await isOllamaRunning()) {
    ownsServer = false
    return { ok: true, message: "The local model runtime is already running." }
  }

  // The app only ever runs the copy it downloaded itself.
  const own = findOllamaBinary()
  const system = own ? null : findSystemOllama()
  const bin = own ?? system
  if (!bin) {
    return { ok: false, message: "Ollama is not installed. Install it from the Local models tab." }
  }

  const env = { ...process.env }
  if (installDir) {
    // Keep the models in the app's own folder so nothing is written outside it.
    env.OLLAMA_MODELS = env.OLLAMA_MODELS ?? join(installDir, "models")
  }

  try {
    const child = spawn(bin, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env
    })
    child.unref()
    server = child
    ownsServer = Boolean(own)
  } catch (err) {
    return { ok: false, message: `Could not start the local model runtime: ${String(err)}` }
  }

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await isOllamaRunning()) {
      return {
        ok: true,
        message: ownsServer
          ? "The local model runtime is running."
          : "The system-wide Ollama runtime was started."
      }
    }
  }

  return { ok: false, message: "The local model runtime did not become ready in time." }
}

/**
 * Stop the runtime.
 *
 * Only a runtime this app started is stopped — a system-wide Ollama belongs
 * to the user, and quietly killing it would be rude. The result says which
 * of the two happened.
 */
export function stopOllamaServer(): { ok: boolean; message: string } {
  if (server && !server.killed && ownsServer) {
    try {
      server.kill()
    } catch {
      /* ignore */
    }
    server = null
    ownsServer = false
    return { ok: true, message: "The local model runtime was stopped." }
  }

  server = null
  ownsServer = false
  return {
    ok: true,
    message:
      "The local model runtime was not started by JARVIS, so it was left alone — stop it from the system tray if you want it off."
  }
}

/** How much space the runtime takes. */
export function runtimeSize(): number {
  return installDir ? fileSize(join(installDir, binaryName())) : 0
}
