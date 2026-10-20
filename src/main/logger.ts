import { app } from "electron"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

let logPath = ""
/** Guards against a failing console triggering an endless error loop. */
let consoleBroken = false

function ensure(): void {
  if (logPath) return
  try {
    const dir = join(app.getPath("userData"), "logs")
    mkdirSync(dir, { recursive: true })
    logPath = join(dir, "jarvis.log")
  } catch {
    logPath = ""
  }
}

function write(level: string, scope: string, message: string, extra?: unknown): void {
  const stamp = new Date().toISOString()
  const tail = extra === undefined ? "" : " " + safeJson(extra)
  const line = `${stamp} [${level}] (${scope}) ${message}${tail}`

  // Writing to stdout can fail (a closed pipe, a detached process). That must
  // never take the app down — and it must never loop.
  if (!consoleBroken) {
    try {
      if (level === "ERROR") console.error(line)
      else if (level === "WARN") console.warn(line)
      else console.log(line)
    } catch {
      consoleBroken = true
    }
  }

  ensure()
  if (!logPath) return
  try {
    appendFileSync(logPath, line + "\n", "utf8")
  } catch {
    /* logging must never crash the app */
  }
}

/**
 * Stop writing to the console.
 *
 * Called when stdout turns out to be a broken pipe — continuing to write to
 * it would produce an endless stream of write errors.
 */
export function markConsoleBroken(): void {
  consoleBroken = true
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function createLogger(scope: string) {
  return {
    info: (m: string, e?: unknown) => write("INFO", scope, m, e),
    warn: (m: string, e?: unknown) => write("WARN", scope, m, e),
    error: (m: string, e?: unknown) => write("ERROR", scope, m, e),
    debug: (m: string, e?: unknown) => write("DEBUG", scope, m, e)
  }
}

export type Logger = ReturnType<typeof createLogger>
