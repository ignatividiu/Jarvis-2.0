import { app } from "electron"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { basename, dirname, extname, join } from "node:path"
import type { OpenCodeSession, OpenCodeStatus } from "@shared/types"
import { config } from "../store"
import { createLogger } from "../logger"
import { fetchJson, ping } from "../net"

const log = createLogger("opencode")

let serverProcess: ChildProcess | null = null
let currentSessionId: string | null = null
let currentDirectory: string | null = null

/**
 * The `opencode serve` command prints a one-time server password and then
 * requires HTTP Basic auth (user `opencode`) for every request. We generate
 * the password ourselves and pass it in, so we always know it — and we also
 * watch stdout in case a server we did not start prints its own.
 */
let serverPassword = ""
let serverUsername = "opencode"
let serverLogPath = ""

/** Where the generated server password is kept in the encrypted key vault. */
const OPENCODE_PASSWORD_SLOT = "opencode-server"

export function opencodePort(): number {
  return activePort ?? (config.get().opencode.port || 4096)
}

export function opencodeBaseUrl(): string {
  return `http://127.0.0.1:${opencodePort()}`
}

/** The port the server actually ended up on (it may differ from the config). */
let activePort: number | null = null

/** Is something already listening on this port? */
async function portInUse(port: number): Promise<boolean> {
  const { createServer } = await import("node:net")
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(true))
    server.once("listening", () => server.close(() => resolve(false)))
    server.listen(port, "127.0.0.1")
  })
}

/** Find a free port near the configured one. */
async function findFreePort(start: number, attempts = 12): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const candidate = start + i
    if (!(await portInUse(candidate))) return candidate
  }
  return start
}

function authHeader(): Record<string, string> {
  if (!serverPassword) {
    // Reuse the password from a previous run so an already-running server
    // (started by this app) stays reachable after a restart.
    const stored = config.getApiKey(OPENCODE_PASSWORD_SLOT)
    if (stored) serverPassword = stored
  }
  if (!serverPassword) return {}
  const token = Buffer.from(`${serverUsername}:${serverPassword}`).toString("base64")
  return { Authorization: `Basic ${token}` }
}

function generatePassword(): string {
  return randomBytes(24).toString("base64url")
}

/** Remember the password so a restarted app can reuse a running server. */
function rememberPassword(password: string): void {
  if (!password) return
  serverPassword = password
  // The server password is a credential — keep it in the encrypted vault
  // rather than in the plain settings file.
  config.setApiKey(OPENCODE_PASSWORD_SLOT, password)
}

/* ──────────────────────────  Binary discovery  ────────────────────────── */

/** Candidate locations for the opencode binary, in priority order. */
function candidatePaths(): string[] {
  const exe = process.platform === "win32" ? "opencode.exe" : "opencode"
  const home = app.getPath("home")
  const candidates = [
    join(app.getPath("userData"), "opencode", exe),
    join(home, ".opencode", "bin", exe),
    join(home, ".local", "bin", exe),
    join(home, "bin", exe),
    join(home, ".bun", "bin", exe),
    "/usr/local/bin/opencode",
    "/usr/bin/opencode",
    "/opt/homebrew/bin/opencode"
  ]
  if (process.platform === "win32") {
    candidates.push(join(process.env.LOCALAPPDATA ?? "", "Programs", "opencode", exe))
    candidates.push(join(process.env.ProgramFiles ?? "C:\\Program Files", "opencode", exe))
  }
  return candidates.filter((p) => existsSync(p))
}

/**
 * Locate the opencode binary.
 *
 * On Windows `where opencode` usually reports the npm shim — a `.cmd` file
 * or an extensionless shell script — before any real executable. A real
 * `.exe` is strongly preferred because it can be spawned without a shell.
 */
export function findOpencodeBinary(): string {
  const onPath: string[] = []
  try {
    const finder = process.platform === "win32" ? "where" : "which"
    const res = spawnSync(finder, ["opencode"], { encoding: "utf8", windowsHide: true, timeout: 6000 })
    for (const line of (res.stdout ?? "").split(/\r?\n/)) {
      const value = line.trim()
      if (value && existsSync(value)) onPath.push(value)
    }
  } catch {
    /* fall through to the known locations */
  }

  // A real executable is always preferred — it can be spawned without a shell.
  const direct = onPath.find((p) => /\.(exe|com)$/i.test(p))
  if (direct) return direct

  // On Windows, `where` often reports an extensionless npm shim. Look for
  // a sibling with a usable extension next to it.
  if (process.platform === "win32") {
    for (const p of onPath) {
      const dir = dirname(p)
      const base = basename(p, extname(p))
      for (const ext of [".exe", ".cmd", ".bat"]) {
        const candidate = join(dir, base + ext)
        if (existsSync(candidate)) return candidate
      }
    }
  }

  const candidates = candidatePaths()
  const local = candidates.find((p) => /\.(exe|com)$/i.test(p)) ?? candidates[0]
  if (local) return local

  return onPath[0] ?? ""
}

/**
 * Spawn helper that handles Windows shims, which need a command interpreter.
 *
 * The child's output goes to a log file rather than a pipe: an inherited pipe
 * would keep the parent's console open long after the app has quit, and it
 * would stop the server from ever being detached cleanly.
 */
function spawnBinary(
  bin: string,
  args: string[],
  extraEnv: Record<string, string> = {}
): { child: ChildProcess; logPath: string } {
  const needsShell = process.platform === "win32" && !/\.(exe|com)$/i.test(bin)
  const command = needsShell ? (process.env.ComSpec ?? "cmd.exe") : bin
  const commandArgs = needsShell ? ["/d", "/s", "/c", bin, ...args] : args

  const logDir = join(app.getPath("userData"), "logs")
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, "opencode-server.log")
  const fd = openSync(logPath, "a")

  const child = spawn(command, commandArgs, {
    // Detached everywhere: the server has to outlive the app, and it must not
    // keep the parent's event loop alive.
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: { ...process.env, ...extraEnv }
  })

  closeSync(fd)
  child.unref()
  return { child, logPath }
}

/** Read the password the server printed, if it printed one. */
function readPrintedPassword(logPath: string): string | undefined {
  try {
    const text = readFileSync(logPath, "utf8")
    const matches = [...text.matchAll(/server password\s+(\S+)/gi)]
    return matches.length ? matches[matches.length - 1][1] : undefined
  } catch {
    return undefined
  }
}

/* ──────────────────────────  Server lifecycle  ────────────────────────── */

/** A server is only usable if we can actually talk to it. */
export async function serverRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${opencodeBaseUrl()}/api/info`, {
      headers: authHeader(),
      signal: AbortSignal.timeout(2500)
    })
    return res.ok
  } catch {
    return false
  }
}

export async function startServer(): Promise<{ ok: boolean; message: string }> {
  // Reuse a server we already know the password for.
  const stored = config.getApiKey(OPENCODE_PASSWORD_SLOT)
  if (stored) {
    serverPassword = stored
    if (await serverRunning()) return { ok: true, message: "OpenCode server already running" }
  }

  const bin = findOpencodeBinary()
  if (!bin) {
    return {
      ok: false,
      message:
        "The opencode binary was not found. Install it from https://opencode.ai/docs and make sure it is on your PATH."
    }
  }

  const port = await findFreePort(opencodePort())
  if (port !== opencodePort()) {
    log.info(`port ${opencodePort()} is busy — using ${port} instead`)
  }
  activePort = port
  const password = generatePassword()
  serverPassword = password

  try {
    const { child, logPath } = spawnBinary(
      bin,
      ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        OPENCODE_SERVER_USERNAME: serverUsername,
        OPENCODE_SERVER_PASSWORD: password
      }
    )
    serverProcess = child
    // A binary that cannot be run reports the failure here. It must never
    // become an unhandled error, or it would take the app down.
    serverProcess.on("error", (err) => {
      log.warn("opencode server process error", String(err))
      serverProcess = null
    })
    serverLogPath = logPath
  } catch (err) {
    return { ok: false, message: `Could not launch opencode: ${String(err)}` }
  }

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))

    // The server prints the password it ended up using — trust that over the
    // value we passed in, in case the environment variable is ignored.
    const printed = readPrintedPassword(serverLogPath)
    if (printed && printed !== serverPassword) {
      serverPassword = printed
      log.info("captured the opencode server password from its output")
    }

    if (await serverRunning()) {
      rememberPassword(serverPassword)
      const current = config.get()
      if (current.opencode.port !== port) {
        config.update({ opencode: { ...current.opencode, port } })
      }
      return { ok: true, message: `OpenCode server started on port ${port}` }
    }
  }
  return { ok: false, message: "The OpenCode server did not become ready in time." }
}

export function stopServer(): void {
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill()
    } catch {
      /* ignore */
    }
  }
  serverProcess = null
  currentSessionId = null
}

/* ──────────────────────────  Sessions  ────────────────────────── */

interface SessionInfo {
  id: string
  title?: string
  time?: { created?: number; updated?: number }
  location?: { directory?: string }
}

async function createSession(title: string, directory?: string): Promise<SessionInfo> {
  const body: Record<string, unknown> = { title }
  if (directory) body.location = { directory }

  const res = await fetchJson<{ data: SessionInfo }>(`${opencodeBaseUrl()}/api/session`, {
    method: "POST",
    headers: authHeader(),
    body,
    timeoutMs: 30_000
  })
  return res.data
}

export async function listSessions(): Promise<OpenCodeSession[]> {
  if (!(await serverRunning())) return []
  try {
    const res = await fetchJson<{ data?: SessionInfo[] }>(`${opencodeBaseUrl()}/api/session?limit=20&order=desc`, {
      headers: authHeader(),
      timeoutMs: 10_000
    })
    return (res.data ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      created: s.time?.created,
      updated: s.time?.updated
    }))
  } catch (err) {
    log.warn("could not list sessions", String(err))
    return []
  }
}

interface MessageContent {
  type?: string
  text?: string
}

interface MessageInfo {
  id: string
  type?: string
  role?: string
  time?: { created?: number; completed?: number }
  content?: MessageContent[]
  error?: { name?: string; data?: { message?: string } }
  outcome?: string
}

function assistantText(message: MessageInfo): string {
  return (message.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n")
}

/**
 * Send a prompt to the OpenCode agent and stream the reply back.
 * Returns the complete assistant text.
 */
export async function runAgent(
  text: string,
  onDelta: (delta: string) => void,
  directory?: string
): Promise<{ ok: boolean; output?: string; error?: string }> {
  if (!(await serverRunning())) {
    const started = await startServer()
    if (!started.ok) return { ok: false, error: started.message }
  }

  const targetDir = directory || currentDirectory || config.get().opencode.directory || process.cwd()

  try {
    if (!currentSessionId || currentDirectory !== targetDir) {
      const session = createSession(`JARVIS — ${new Date().toLocaleString()}`, targetDir)
      currentSessionId = (await session).id
      currentDirectory = targetDir
    }

    const res = await fetchJson<{ data?: unknown }>(
      `${opencodeBaseUrl()}/api/session/${encodeURIComponent(currentSessionId)}/prompt`,
      { method: "POST", headers: authHeader(), body: { text }, timeoutMs: 60_000 }
    )
    if (!res) return { ok: false, error: "OpenCode rejected the prompt." }

    // Stream the reply by polling the message list while the agent works.
    // The session emits an "idle" message when the agent loop finishes.
    const seen = new Map<string, number>()
    const deadline = Date.now() + 15 * 60_000

    while (Date.now() < deadline) {
      const messages = await fetchJson<{ data?: MessageInfo[] }>(
        `${opencodeBaseUrl()}/api/session/${encodeURIComponent(currentSessionId)}/message`,
        { headers: authHeader(), timeoutMs: 20_000 }
      )
      const list = messages.data ?? []

      // The API returns the newest message first — sort chronologically so
      // the "idle" marker can be identified regardless of the order.
      const ordered = [...list].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
      const newest = ordered[ordered.length - 1]

      // Emit any new assistant text, message by message.
      for (const message of ordered) {
        if (message.type !== "assistant") continue
        const text = assistantText(message)
        if (!text) continue
        const already = seen.get(message.id) ?? 0
        if (text.length > already) {
          onDelta(text.slice(already))
          seen.set(message.id, text.length)
        }
        if (message.error) {
          return { ok: false, error: message.error.data?.message ?? message.error.name ?? "Agent error" }
        }
      }

      // The session is finished when the newest entry says it went idle.
      if (newest?.type === "idle") {
        if (newest.outcome === "failed") {
          return { ok: false, error: newest.error?.data?.message ?? "The coding agent failed." }
        }
        return { ok: true, output: outputOf(ordered) }
      }

      await new Promise((r) => setTimeout(r, 400))
    }

    return { ok: false, error: "The coding agent timed out." }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn("agent run failed", message)
    return { ok: false, error: message }
  }
}

/** The final answer is the last assistant message that carries text. */
function outputOf(ordered: MessageInfo[]): string {
  for (let i = ordered.length - 1; i >= 0; i--) {
    const message = ordered[i]
    if (message.type !== "assistant") continue
    const text = assistantText(message)
    if (text.trim()) return text.trim()
  }
  return ordered
    .filter((m) => m.type === "assistant")
    .map((m) => assistantText(m))
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

export function setDirectory(directory: string): void {
  currentDirectory = directory
  currentSessionId = null
}

/* ──────────────────────────  Status  ────────────────────────── */

export async function opencodeStatus(): Promise<OpenCodeStatus> {
  const running = await serverRunning()
  const cfg = config.get()
  const binaryPath = findOpencodeBinary()

  if (!running) {
    return {
      available: Boolean(binaryPath),
      running: false,
      baseUrl: opencodeBaseUrl(),
      directory: cfg.opencode.directory || process.cwd(),
      sessions: [],
      binaryPath: binaryPath || undefined,
      error: binaryPath ? undefined : "opencode was not found on this machine."
    }
  }

  let version: string | undefined
  try {
    const info = await fetchJson<{ version?: string }>(`${opencodeBaseUrl()}/api/info`, {
      headers: authHeader(),
      timeoutMs: 8000
    })
    version = info.version
  } catch {
    /* ignore */
  }

  return {
    available: true,
    running: true,
    baseUrl: opencodeBaseUrl(),
    version,
    directory: currentDirectory || cfg.opencode.directory || process.cwd(),
    sessions: await listSessions(),
    binaryPath: binaryPath || undefined
  }
}

/* ──────────────────────────  Web search via opencode  ────────────────────────── */

interface WebSearchResponse {
  location?: unknown
  data?: { providerID?: string; results?: Array<{ url?: string; title?: string; content?: string }> }
}

export async function opencodeWebSearch(query: string): Promise<Array<{ title: string; url: string; snippet: string; source: string }>> {
  if (!(await serverRunning())) return []
  try {
    const res = await fetchJson<WebSearchResponse>(`${opencodeBaseUrl()}/api/websearch`, {
      method: "POST",
      headers: authHeader(),
      body: { query },
      timeoutMs: 30_000
    })
    return (res.data?.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "Untitled",
      url: r.url ?? "",
      snippet: (r.content ?? "").replace(/\s+/g, " ").trim(),
      source: res.data?.providerID ?? "opencode"
    }))
  } catch (err) {
    log.warn("opencode websearch failed", String(err))
    return []
  }
}
