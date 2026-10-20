import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { spawnSync } from "node:child_process"
import { createLogger } from "./logger"

const log = createLogger("net")

export interface FetchOptions {
  timeoutMs?: number
  headers?: Record<string, string>
  method?: string
  body?: unknown
  raw?: boolean
  signal?: AbortSignal
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public url: string
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 300)}`)
    this.name = "HttpError"
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 60_000, headers = {}, method = "GET", body, signal } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true })

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })
    const text = await res.text()
    if (!res.ok) throw new HttpError(res.status, text, url)
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new HttpError(res.status, `invalid JSON: ${text.slice(0, 200)}`, url)
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 60_000, headers = {}, method = "GET", body, signal } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true })
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })
    const text = await res.text()
    if (!res.ok) throw new HttpError(res.status, text, url)
    return text
  } finally {
    clearTimeout(timer)
  }
}

/** Probe a URL; returns true when it answers with a 2xx/3xx within the timeout. */
export async function ping(url: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))
    return res.ok || res.status === 401 || res.status === 403
  } catch {
    return false
  }
}

/* ────────────────────────────  Downloads  ──────────────────────────── */

export interface DownloadProgress {
  received: number
  total: number
  percent: number
}

export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (p: DownloadProgress) => void
): Promise<string> {
  mkdirSync(join(dest, ".."), { recursive: true })
  log.info(`downloading ${url} -> ${dest}`)

  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${res.statusText}`)

  const total = Number(res.headers.get("content-length") ?? 0)
  let received = 0
  let lastReport = 0

  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  source.on("data", (chunk: Buffer) => {
    received += chunk.length
    const now = Date.now()
    if (onProgress && now - lastReport > 250) {
      lastReport = now
      onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : 0 })
    }
  })

  await pipeline(source, createWriteStream(dest))
  if (onProgress) onProgress({ received, total: total || received, percent: 100 })
  return dest
}

export async function downloadJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  return fetchJson<T>(url, opts)
}

/* ────────────────────────────  Processes  ──────────────────────────── */

export function which(binary: string): string | null {
  const finder = process.platform === "win32" ? "where" : "which"
  try {
    const out = spawnSyncText(finder, [binary])
    const first = out.split(/\r?\n/).find((l) => l.trim().length > 0)
    return first ? first.trim() : null
  } catch {
    return null
  }
}

export function spawnSyncText(cmd: string, args: string[]): string {
  const res = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 10_000 })
  return `${res.stdout ?? ""}${res.stderr ?? ""}`
}

export function fileSize(path: string): number {
  try {
    return existsSync(path) ? statSync(path).size : 0
  } catch {
    return 0
  }
}
