import { BrowserWindow, ipcMain, shell, app } from "electron"
import type {
  ChatRequest,
  ProviderTestResult,
  ProviderStatus,
  SearchResponse,
  Settings,
  SetupProgress,
  SetupResult,
  SpeakRequest,
  SpeakResult,
  TranscribeRequest,
  TranscribeResult,
  VoiceStatus
} from "@shared/types"
import { config } from "./store"
import { createLogger } from "./logger"
import {
  discoverModels,
  listProviderStatus,
  resetRotationHealth,
  testProvider
} from "./providers/rotation"
import { runAssistant, runCodeAgent, looksLikeCodeTask } from "./agent/orchestrator"
import { searchWeb } from "./tools/websearch"
import { localStatus, pullModel, removeModel } from "./tools/local"
import {
  opencodeStatus,
  runAgent,
  setDirectory,
  startServer
} from "./tools/opencode"
import { installOllama, startOllamaServer, stopOllamaServer } from "./setup/ollama"
import {
  downloadSpeechModel,
  installOfflineVoice,
  removeOfflineVoice,
  speak,
  speechModels,
  transcribe,
  voiceStatus
} from "./voice"

const log = createLogger("ipc")

let activeWindow: BrowserWindow | null = null
let abortController: AbortController | null = null
let sendCounter = 0
let lastSetupProgress: SetupProgress = {
  stage: "idle",
  component: "providers",
  percent: 0,
  message: "Ready"
}

export function setActiveWindow(win: BrowserWindow | null): void {
  activeWindow = win
}

function send(channel: string, payload: unknown): void {
  if (activeWindow && !activeWindow.isDestroyed()) {
    activeWindow.webContents.send(channel, payload)
  }
}

/* ──────────────────────────  Registration  ────────────────────────── */

export function registerIpc(): void {
  /* ── App ── */
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    userDataPath: app.getPath("userData"),
    homePath: app.getPath("home")
  }))

  ipcMain.handle("app:openExternal", async (_e, url: string) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle("app:openPath", async (_e, path: string) => {
    if (typeof path === "string") await shell.openPath(path)
  })

  // Development aid: sends a message on launch so the chat UI can be
  // exercised without typing. Set JARVIS_DEMO_PROMPT to use it.
  ipcMain.handle("app:demoPrompt", () => process.env.JARVIS_DEMO_PROMPT ?? "")

  // Development aid: opens a settings tab on launch, e.g.
  // JARVIS_OPEN_SETTINGS=providers.
  ipcMain.handle("app:openSettingsTab", () => process.env.JARVIS_OPEN_SETTINGS ?? "")

  /* ── Settings ── */
  ipcMain.handle("settings:get", () => config.get())
  ipcMain.handle("settings:update", (_e, patch: Partial<Settings>) => config.update(patch ?? {}))
  ipcMain.handle("settings:reset", () => {
    resetRotationHealth()
    return config.reset()
  })
  ipcMain.handle("settings:setApiKey", (_e, providerId: string, key: string) => {
    config.setApiKey(providerId, key ?? "")
    resetRotationHealth()
    return listProviderStatus()
  })
  ipcMain.handle("settings:clearApiKey", (_e, providerId: string) => {
    config.clearApiKey(providerId)
    resetRotationHealth()
    return listProviderStatus()
  })
  ipcMain.handle("settings:hasApiKey", (_e, providerId: string) => config.hasApiKey(providerId))

  /* ── Providers ── */
  ipcMain.handle("providers:list", () => listProviderStatus())
  ipcMain.handle("providers:discover", async (_e, providerId: string) => {
    await discoverModels(providerId, true)
    return listProviderStatus()
  })
  ipcMain.handle("providers:test", (_e, providerId: string, model?: string): Promise<ProviderTestResult> =>
    testProvider(providerId, model)
  )
  ipcMain.handle("providers:testAll", async (): Promise<ProviderTestResult[]> => {
    const providers = await listProviderStatus()
    const configured = providers.filter((p) => p.configured)
    const results: ProviderTestResult[] = []
    // Test in parallel — the point is to see everything at once.
    await Promise.all(
      configured.map(async (provider) => {
        results.push(await testProvider(provider.id))
      })
    )
    return results
  })

  /* ── Chat ── */
  ipcMain.handle("chat:send", async (_e, request: ChatRequest) => {
    sendCounter += 1
    log.info(`chat:send #${sendCounter}: ${(request.text ?? "").slice(0, 80)}`)
    abortController?.abort()
    abortController = new AbortController()
    const signal = abortController.signal

    const cfg = config.get()
    const useCodeAgent =
      cfg.opencode.enabled &&
      (request.mode === "code" || (request.mode === "auto" && cfg.agent.autoRouteCode && looksLikeCodeTask(request.text ?? "")))

    send("chat:chunk", { type: "start" })

    try {
      if (useCodeAgent) {
        await runCodeAgent(request.text ?? "", request.directory, (chunk) => send("chat:chunk", chunk))
      } else {
        await runAssistant({
          text: request.text ?? "",
          history: request.history ?? [],
          tools: request.tools,
          directory: request.directory,
          signal,
          emit: (chunk) => send("chat:chunk", chunk)
        })
      }
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      send("chat:chunk", { type: "error", error: message })
      return { ok: false, error: message }
    } finally {
      abortController = null
    }
  })

  ipcMain.handle("chat:cancel", () => {
    abortController?.abort()
    abortController = null
    return { ok: true }
  })

  /* ── Voice ── */
  ipcMain.handle("voice:status", () => voiceStatus())
  ipcMain.handle("voice:speak", (_e, request: SpeakRequest): Promise<SpeakResult> => speak(request ?? { text: "" }))
  ipcMain.handle("voice:stop", () => ({ ok: true }))
  ipcMain.handle(
    "voice:transcribe",
    async (_e, request: TranscribeRequest): Promise<TranscribeResult> =>
      transcribe(request ?? { samples: new Float32Array(), sampleRate: 16000 })
  )
  ipcMain.handle("voice:models", () => speechModels())
  ipcMain.handle("voice:downloadModel", async (_e, modelId: string) => {
    const result = await downloadSpeechModel(modelId, (percent, message) => {
      lastSetupProgress = { stage: "downloading", component: "speech", percent, message }
      send("setup:progress", lastSetupProgress)
    })
    // The renderer shows which models are installed, so it needs to know.
    send("voice:changed", undefined)
    return result
  })
  ipcMain.handle("voice:installPiper", async (_e, voiceId?: string) => {
    const result = await installOfflineVoice(voiceId ?? "en_GB-alan-medium", (percent, message, bytes) => {
      lastSetupProgress = { stage: "downloading", component: "voice", percent, message, bytes }
      send("setup:progress", lastSetupProgress)
    })
    send("voice:changed", undefined)
    return result
  })
  ipcMain.handle("voice:uninstallPiper", () => {
    const result = removeOfflineVoice()
    send("voice:changed", undefined)
    return result
  })
  ipcMain.handle("voice:openPiper", () => {
    void shell.openExternal("https://github.com/rhasspy/piper")
    return { ok: true }
  })

  /* ── Remote access ── */
  ipcMain.handle("remote:status", async () => {
    const { remoteStatus } = await import("./remote/server")
    return remoteStatus()
  })
  ipcMain.handle("remote:start", async () => {
    const { startRemote } = await import("./remote/server")
    return startRemote()
  })
  ipcMain.handle("remote:stop", async () => {
    const { stopRemote } = await import("./remote/server")
    return stopRemote()
  })
  ipcMain.handle("remote:rotateToken", async () => {
    const { rotateToken } = await import("./remote/server")
    return rotateToken()
  })
  ipcMain.handle("remote:addresses", async () => {
    const { remoteAddresses } = await import("./remote/server")
    const port = config.get().remote.port
    return remoteAddresses(port)
  })

  /* ── Local models ── */
  ipcMain.handle("local:status", () => localStatus())
  ipcMain.handle("local:install", async () => {
    const result = await installOllama((p) => {
      lastSetupProgress = p
      send("setup:progress", p)
    })
    return result
  })
  ipcMain.handle("local:pull", async (_e, tag: string) => {
    const status = await pullModel(tag, (p) => {
      lastSetupProgress = p
      send("setup:progress", p)
    })
    return status
  })
  ipcMain.handle("local:remove", (_e, tag: string) => removeModel(tag))
  ipcMain.handle("local:start", async () => {
    const result = await startOllamaServer()
    if (result.ok) log.info(`local runtime started: ${result.message}`)
    else log.warn(`the local runtime did not start: ${result.message}`)
    return result
  })
  ipcMain.handle("local:stop", async () => {
    const result = await stopOllamaServer()
    log.info(`local runtime stopped: ${result.message}`)
    return result
  })
  ipcMain.handle("local:restart", async () => {
    await stopOllamaServer()
    const result = await startOllamaServer()
    if (result.ok) log.info(`local runtime restarted: ${result.message}`)
    else log.warn(`the local runtime did not restart: ${result.message}`)
    return result
  })

  /* ── Web search ── */
  ipcMain.handle("websearch:search", (_e, query: string, engine?: string): Promise<SearchResponse> =>
    searchWeb(query, engine)
  )

  /* ── OpenCode ── */
  ipcMain.handle("opencode:status", () => opencodeStatus())
  ipcMain.handle("opencode:start", async () => {
    const started = await startServer()
    return { ...(await opencodeStatus()), error: started.ok ? undefined : started.message }
  })
  ipcMain.handle("opencode:prompt", async (_e, text: string, directory?: string) => {
    let output = ""
    const result = await runAgent(text, (d) => (output += d), directory)
    return { ok: result.ok, output: result.output ?? output, error: result.error }
  })
  ipcMain.handle("opencode:sessions", () => opencodeStatus().then((s) => s.sessions))
  ipcMain.handle("opencode:setDirectory", async (_e, directory: string) => {
    setDirectory(directory)
    config.update({ opencode: { ...config.get().opencode, directory } })
    return opencodeStatus()
  })

  /* ── Setup ── */
  ipcMain.handle("setup:status", () => lastSetupProgress)
  ipcMain.handle(
    "setup:run",
    async (_e, options: { ollama: boolean; models: boolean; voice: boolean; speech: boolean }): Promise<SetupResult> => {
      const logLines: string[] = []
      const push = (p: SetupProgress) => {
        lastSetupProgress = p
        send("setup:progress", p)
        if (p.message) logLines.push(`[${p.component}] ${p.message}`)
      }

      push({ stage: "checking", component: "providers", percent: 5, message: "Checking configured providers…" })
      const providers = await listProviderStatus()
      const configured = providers.filter((p) => p.configured)
      logLines.push(
        `${configured.length} provider(s) ready: ${configured.map((p) => p.label).join(", ") || "none"}`
      )

      let ollama = null
      let voice = null

      if (options.ollama) {
        push({ stage: "checking", component: "ollama", percent: 10, message: "Checking the local model runtime…" })
        const status = await localStatus()
        if (!status.installed) {
          push({ stage: "downloading", component: "ollama", percent: 15, message: "Installing Ollama…" })
          const result = await installOllama(push)
          logLines.push(result.message)
        } else {
          push({ stage: "done", component: "ollama", percent: 30, message: "Ollama is already installed." })
        }
        ollama = await localStatus()
      }

      if (options.models) {
        const status = await localStatus()
        if (status.available) {
          const preferred = config.get().local.model || status.catalogue.find((m) => m.recommended)?.tag
          if (preferred) {
            push({ stage: "pulling", component: "models", percent: 40, message: `Downloading ${preferred}…` })
            await pullModel(preferred, push)
            config.update({ local: { ...config.get().local, model: preferred } })
          }
        }
      }

      if (options.speech) {
        push({ stage: "checking", component: "speech", percent: 55, message: "Checking the speech recognition model…" })
        const models = speechModels()
        const installed = models.find((m) => m.installed)
        const wanted = installed?.id ?? config.get().voice.sttModel
        push({ stage: "downloading", component: "speech", percent: 58, message: `Downloading ${wanted}…` })
        const result = await downloadSpeechModel(wanted, (percent, message) =>
          push({ stage: "downloading", component: "speech", percent: 58 + Math.round(percent * 0.3), message })
        )
        logLines.push(result.message)
      }

      if (options.voice) {
        push({ stage: "checking", component: "voice", percent: 88, message: "Checking the voice engine…" })
        const status = await voiceStatus()
        if (!status.edgeReachable && !status.piperInstalled) {
          push({
            stage: "downloading",
            component: "voice",
            percent: 90,
            message: "Downloading the offline voice engine so JARVIS can speak without an internet connection…"
          })
          const result = await installOfflineVoice("en_GB-alan-medium", (percent, message, bytes) =>
            push({ stage: "downloading", component: "voice", percent: 90 + Math.round(percent * 0.08), message, bytes })
          )
          logLines.push(result.message)
        } else {
          push({ stage: "done", component: "voice", percent: 96, message: "The voice engine is ready." })
        }
        voice = await voiceStatus()
      }

      push({ stage: "done", component: "providers", percent: 100, message: "Setup complete." })
      return { ok: true, ollama, voice, providers, log: logLines }
    }
  )

  log.info("IPC handlers registered")
}
