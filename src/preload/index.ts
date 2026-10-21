import { contextBridge, ipcRenderer } from "electron"
import type {
  AppInfo,
  AudioDevice,
  AudioDevices,
  ChatRequest,
  JarvisApi,
  LocalStatus,
  OpenCodeSession,
  OpenCodeStatus,
  ProviderStatus,
  ProviderTestResult,
  RemoteStatus,
  SearchResponse,
  SetupProgress,
  SetupResult,
  Settings,
  SpeakRequest,
  SpeakResult,
  SpeechModelStatus,
  TranscribeRequest,
  TranscribeResult,
  VoiceStatus
} from "@shared/types"

/**
 * Audio device discovery.
 *
 * This runs in the renderer because it needs the browser's device APIs.
 * Labels are only exposed once the user has granted microphone permission,
 * so the list is refreshed after every successful capture.
 */
async function listDevices(): Promise<AudioDevices> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return { inputs: [], outputs: [], permitted: false, canSelectOutput: false, error: "No media devices API." }
  }

  try {
    const all = await navigator.mediaDevices.enumerateDevices()

    const inputs: AudioDevice[] = all
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
        kind: "input" as const,
        isDefault: d.deviceId === "default" || d.deviceId === ""
      }))

    const outputs: AudioDevice[] = all
      .filter((d) => d.kind === "audiooutput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Speaker ${i + 1}`,
        kind: "output" as const,
        isDefault: d.deviceId === "default" || d.deviceId === ""
      }))

    // Labels only appear after permission has been granted, so a labelled
    // device means the microphone is available.
    const permitted = inputs.some((d) => d.label && !d.label.startsWith("Microphone "))

    const ctx = new AudioContext()
    const canSelectOutput = typeof (ctx as AudioContext & { setSinkId?: unknown }).setSinkId === "function"
    await ctx.close().catch(() => undefined)

    return { inputs, outputs, permitted, canSelectOutput }
  } catch (err) {
    return {
      inputs: [],
      outputs: [],
      permitted: false,
      canSelectOutput: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

const api: JarvisApi = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke("app:info"),
    openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
    openPath: (path: string) => ipcRenderer.invoke("app:openPath", path),
    demoPrompt: (): Promise<string> => ipcRenderer.invoke("app:demoPrompt"),
    openSettingsTab: (): Promise<string> => ipcRenderer.invoke("app:openSettingsTab")
  },

  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
    update: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke("settings:update", patch),
    reset: (): Promise<Settings> => ipcRenderer.invoke("settings:reset"),
    setApiKey: (providerId: string, key: string): Promise<ProviderStatus[]> =>
      ipcRenderer.invoke("settings:setApiKey", providerId, key),
    clearApiKey: (providerId: string): Promise<ProviderStatus[]> =>
      ipcRenderer.invoke("settings:clearApiKey", providerId),
    hasApiKey: (providerId: string): Promise<boolean> => ipcRenderer.invoke("settings:hasApiKey", providerId)
  },

  providers: {
    list: (): Promise<ProviderStatus[]> => ipcRenderer.invoke("providers:list"),
    discover: (providerId: string): Promise<ProviderStatus[]> => ipcRenderer.invoke("providers:discover", providerId),
    test: (providerId: string, model?: string): Promise<ProviderTestResult> =>
      ipcRenderer.invoke("providers:test", providerId, model),
    testAll: (): Promise<ProviderTestResult[]> => ipcRenderer.invoke("providers:testAll")
  },

  chat: {
    send: (request: ChatRequest): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke("chat:send", request),
    cancel: (): Promise<void> => ipcRenderer.invoke("chat:cancel")
  },

  voice: {
    status: (): Promise<VoiceStatus> => ipcRenderer.invoke("voice:status"),
    speak: (request: SpeakRequest): Promise<SpeakResult> => ipcRenderer.invoke("voice:speak", request),
    stop: (): Promise<void> => ipcRenderer.invoke("voice:stop"),
    transcribe: (request: TranscribeRequest): Promise<TranscribeResult> =>
      ipcRenderer.invoke("voice:transcribe", request),
    models: (): Promise<SpeechModelStatus[]> => ipcRenderer.invoke("voice:models"),
    downloadModel: (modelId: string): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke("voice:downloadModel", modelId),
    installPiper: (voiceId?: string): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke("voice:installPiper", voiceId),
    uninstallPiper: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke("voice:uninstallPiper"),
    openPiper: (): Promise<void> => ipcRenderer.invoke("voice:openPiper")
  },

  audio: {
    devices: (): Promise<AudioDevices> => listDevices()
  },

  remote: {
    status: (): Promise<RemoteStatus> => ipcRenderer.invoke("remote:status"),
    start: (): Promise<RemoteStatus> => ipcRenderer.invoke("remote:start"),
    stop: (): Promise<RemoteStatus> => ipcRenderer.invoke("remote:stop"),
    rotateToken: (): Promise<RemoteStatus> => ipcRenderer.invoke("remote:rotateToken"),
    addresses: (): Promise<string[]> => ipcRenderer.invoke("remote:addresses")
  },

  local: {
    status: (): Promise<LocalStatus> => ipcRenderer.invoke("local:status"),
    install: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke("local:install"),
    pull: (tag: string): Promise<LocalStatus> => ipcRenderer.invoke("local:pull", tag),
    remove: (tag: string): Promise<LocalStatus> => ipcRenderer.invoke("local:remove", tag),
    /** Start the local model runtime. */
    start: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke("local:start"),
    /** Stop the local model runtime. */
    stop: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke("local:stop"),
    /** Stop and start the local model runtime. */
    restart: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke("local:restart")
  },

  websearch: {
    search: (query: string, engine?: string): Promise<SearchResponse> =>
      ipcRenderer.invoke("websearch:search", query, engine)
  },

  opencode: {
    status: (): Promise<OpenCodeStatus> => ipcRenderer.invoke("opencode:status"),
    start: (): Promise<OpenCodeStatus> => ipcRenderer.invoke("opencode:start"),
    prompt: (text: string, directory?: string): Promise<{ ok: boolean; output?: string; error?: string }> =>
      ipcRenderer.invoke("opencode:prompt", text, directory),
    sessions: (): Promise<OpenCodeSession[]> => ipcRenderer.invoke("opencode:sessions"),
    setDirectory: (directory: string): Promise<OpenCodeStatus> => ipcRenderer.invoke("opencode:setDirectory", directory)
  },

  setup: {
    run: (options): Promise<SetupResult> => ipcRenderer.invoke("setup:run", options),
    status: (): Promise<SetupProgress> => ipcRenderer.invoke("setup:status")
  },

  events: {
    on: (channel: string, handler: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => handler(payload)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld("jarvis", api)
