import { app, BrowserWindow, protocol, shell, session } from "electron"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { config } from "./store"
import { createLogger, markConsoleBroken } from "./logger"
import { registerIpc, setActiveWindow } from "./ipc"
import { startOllamaServer, stopOllamaServer, configureOllama } from "./setup/ollama"
import { startServer, stopServer } from "./tools/opencode"
import { configurePiper } from "./voice/piper"
import { configureWhisper } from "./voice/whisper"
import { getClip } from "./voice"

const log = createLogger("main")

/**
 * electron-vite dev sets ELECTRON_RENDERER_URL. When it is absent the app is
 * running from a build (or a packaged install) and loads the bundled files.
 */
const devUrl = process.env.ELECTRON_RENDERER_URL
const isDev = Boolean(devUrl)

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  },
  {
    scheme: "jarvismedia",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true }
  }
])

let mainWindow: BrowserWindow | null = null

/**
 * Locate the bundled preload script. electron-vite emits `.mjs` for an ESM
 * package and `.js` for a CommonJS one — support both so the app runs
 * regardless of how the package is configured.
 */
function resolvePreloadPath(): string {
  const candidates = [
    join(__dirname, "../preload/index.mjs"),
    join(__dirname, "../preload/index.js")
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

function createWindow(): void {
  const theme = config.get().ui.theme

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: theme === "light" ? "#f6f7fb" : "#05070d",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 16, y: 18 } : undefined,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  setActiveWindow(mainWindow)

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
  })

  // A custom protocol never fires ready-to-show in some Electron builds, so
  // make sure the window appears once the page has loaded either way.
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow && !mainWindow.isVisible()) {
      setTimeout(() => mainWindow?.show(), 250)
    }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
    setActiveWindow(null)
  })

  // Surface renderer console output in the app log — invaluable for
  // diagnosing renderer-side problems.
  mainWindow.webContents.on("console-message", (event) => {
    const level = event.level ?? "info"
    const line = `[renderer:${level}] ${event.message}`
    if (level === "error" || level === "warning") log.warn(line)
    else log.info(line)
  })

  mainWindow.webContents.on("did-finish-load", () => {
    void captureDebugScreenshot()
  })

  // External links open in the user's browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })

  if (isDev) {
    void mainWindow.loadURL(devUrl!)
  } else {
    void mainWindow.loadURL("app://jarvis/index.html")
  }
}

/**
 * Development aid: `JARVIS_SCREENSHOT=<path>` writes a PNG of the window
 * once it has rendered. Used by scripts/capture.ps1 to verify the UI.
 */
async function captureDebugScreenshot(): Promise<void> {
  const target = process.env.JARVIS_SCREENSHOT
  if (!target || !mainWindow) return
  if (screenshotTaken) return
  screenshotTaken = true
  try {
    const delay = Number(process.env.JARVIS_SCREENSHOT_DELAY ?? 2500)
    await new Promise((r) => setTimeout(r, delay))
    const image = await mainWindow.webContents.capturePage()
    writeFileSync(target, image.toPNG())
    log.info(`screenshot written to ${target}`)
    if (process.env.JARVIS_SCREENSHOT_QUIT === "1") app.quit()
  } catch (err) {
    log.warn("screenshot failed", String(err))
  }
}

let screenshotTaken = false

/**
 * Serve the built renderer over a custom `app://` origin.
 *
 * A `file://` page has an opaque origin, which blocks every cross-origin
 * fetch — including the assistant's own audio. Serving the UI from a proper
 * standard scheme gives it a real origin, so the media protocol and the
 * local API endpoints are reachable.
 */
function registerAppProtocol(): void {
  const root = join(__dirname, "../renderer")
  protocol.handle("app", async (request) => {
    const url = new URL(request.url)
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html"
    const target = join(root, relative)

    // Never serve anything outside the renderer bundle.
    if (!target.startsWith(root)) {
      return new Response("forbidden", { status: 403 })
    }

    try {
      const data = readFileSync(target)
      const contentType = contentTypeFor(target)
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache"
        }
      })
    } catch {
      // Fall back to the entry point for client-side routes.
      try {
        const data = readFileSync(join(root, "index.html"))
        return new Response(data, { status: 200, headers: { "Content-Type": "text/html" } })
      } catch {
        return new Response("not found", { status: 404 })
      }
    }
  })
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json"
}

function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase()
  return CONTENT_TYPES[ext] ?? "application/octet-stream"
}

/**
 * Serve generated speech to the renderer.
 *
 * The clip stays in the main process and is streamed back through
 * `jarvismedia://speech/<id>`, which keeps large audio payloads out of the
 * IPC channel and lets the renderer decode it for the visualiser.
 */
function registerMediaProtocol(): void {
  protocol.handle("jarvismedia", async (request) => {
    const url = new URL(request.url)

    if (url.hostname === "speech") {
      const id = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
      if (!id) return new Response("missing id", { status: 400 })

      const clip = getClip(id)
      if (!clip) return new Response("clip expired", { status: 404 })

      const body = clip.buffer.buffer.slice(
        clip.buffer.byteOffset,
        clip.buffer.byteOffset + clip.buffer.byteLength
      ) as ArrayBuffer

      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": clip.mimeType,
          "Content-Length": String(clip.buffer.byteLength),
          "Cache-Control": "no-store",
          // The renderer fetches this through the Web Audio API, so the
          // response has to be CORS-readable.
          "Access-Control-Allow-Origin": "*"
        }
      })
    }

    return new Response("not found", { status: 404 })
  })
}

async function bootstrapServices(): Promise<void> {
  const cfg = config.get()

  // The remote-access server, when it is switched on. It starts first so it
  // is reachable straight away — the other services can take their time.
  try {
    const { syncRemote, rotateToken, remoteStatus } = await import("./remote/server")
    if (!config.get().remote.token) {
      // A pairing token is generated the first time the app runs.
      rotateToken()
    }
    await syncRemote()
    const remote = remoteStatus()
    if (remote.running) {
      log.info(`remote access is listening on ${remote.addresses.join(", ") || `port ${remote.port}`}`)
    }
  } catch (err) {
    log.warn("remote access could not start", String(err))
  }

  // The local runtime and the coding agent start in the background; neither
  // should hold up the other.
  const background = [
    (async () => {
      if (!cfg.local.enabled || !cfg.local.autostart) return
      try {
        const started = await startOllamaServer()
        if (!started.ok) log.info(`local runtime not started: ${started.message}`)
      } catch (err) {
        log.warn("local runtime autostart failed", String(err))
      }
    })(),
    (async () => {
      if (!cfg.opencode.enabled || !cfg.opencode.autostart) return
      try {
        const started = await startServer()
        if (!started.ok) log.info(`opencode not started: ${started.message}`)
      } catch (err) {
        log.warn("opencode autostart failed", String(err))
      }
    })()
  ]

  // The failures are already handled inside each task.
  await Promise.allSettled(background)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    // JARVIS 2.0 keeps its own settings, so it can sit next to 1.x without
    // the two fighting over the same configuration file.
    try {
      app.setPath("userData", join(app.getPath("appData"), "jarvis-2.0"))
    } catch (err) {
      log.warn("could not set the user data folder", String(err))
    }

    config.init()
    registerIpc()
    registerAppProtocol()
    registerMediaProtocol()

    // Point the voice engines and the local runtime at the app's data folder.
    const dataDir = app.getPath("userData")
    configurePiper(dataDir)
    configureWhisper(dataDir)
    configureOllama(dataDir)

    // A stray error in a background task must never take the app down, and a
    // broken stdout must never turn into an endless error loop.
    for (const stream of [process.stdout, process.stderr]) {
      stream?.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED" || err.code === "ERR_STREAM_WRITE_AFTER_END") {
          markConsoleBroken()
          return
        }
        log.warn("stream error", err.message)
      })
    }

    let handlingError = false
    const isPipeNoise = (value: unknown): boolean => {
      if (!value) return false
      const code = (value as NodeJS.ErrnoException | undefined)?.code
      if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END") return true
      try {
        const text = JSON.stringify(value)
        return typeof text === "string" && text.includes("EPIPE")
      } catch {
        return false
      }
    }

    process.on("uncaughtException", (err) => {
      // A closed stdout (a piped or detached process) surfaces as EPIPE.
      // It is noise, not a fault, and must not be reported in a loop.
      if (isPipeNoise(err)) {
        markConsoleBroken()
        return
      }
      if (handlingError) return
      handlingError = true
      log.error("uncaught exception", err)
      handlingError = false
    })
    process.on("unhandledRejection", (reason) => {
      if (isPipeNoise(reason)) {
        markConsoleBroken()
        return
      }
      log.error("unhandled rejection", reason)
    })

    // Grant the renderer access to the microphone.
    try {
      await session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
        if (permission === "media") {
          callback(true)
          return
        }
        callback(false)
      })
      await session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
        permission === "media" ? true : false
      )
    } catch (err) {
      log.warn("could not set permission handler", String(err))
    }

    createWindow()
    void bootstrapServices()

    // Headless integration check: `JARVIS_SELFTEST=1`.
    if (process.env.JARVIS_SELFTEST === "1") {
      const { runSelfTest } = await import("./selftest")
      await runSelfTest(process.env.JARVIS_SELFTEST_PROMPT)
      app.quit()
      return
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("before-quit", () => {
    log.info("shutting down")
    // Stop the services this app started so nothing is left running.
    try {
      stopServer()
      stopOllamaServer()
    } catch (err) {
      log.warn("could not stop the local services", String(err))
    }  })
}
