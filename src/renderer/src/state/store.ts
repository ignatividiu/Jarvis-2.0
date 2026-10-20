import { create } from "zustand"
import type {
  AudioDevices,
  ChatChunk,
  LocalStatus,
  OpenCodeStatus,
  ProviderStatus,
  Settings,
  UiMessage,
  VoiceStatus
} from "@shared/types"

export type AssistantState = "idle" | "listening" | "thinking" | "speaking"

export interface Toast {
  id: string
  message: string
  kind: "info" | "success" | "error"
}

interface JarvisState {
  ready: boolean
  settings: Settings | null
  providers: ProviderStatus[]
  voice: VoiceStatus | null
  local: LocalStatus | null
  opencode: OpenCodeStatus | null
  devices: AudioDevices | null

  messages: UiMessage[]
  streamingText: string
  streamingProvider?: string
  streamingModel?: string
  toolCalls: Array<{ name: string; ok?: boolean; summary?: string }>
  /** A transient status note shown under the streaming message. */
  notice?: string
  state: AssistantState

  sidebarCollapsed: boolean
  hudCollapsed: boolean
  visualizerExpanded: boolean
  settingsOpen: boolean
  setupOpen: boolean
  setupTab: string

  toasts: Toast[]

  init: () => Promise<void>
  refreshProviders: () => Promise<void>
  refreshVoice: () => Promise<void>
  refreshLocal: () => Promise<void>
  refreshOpencode: () => Promise<void>
  refreshDevices: () => Promise<void>
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  addMessage: (message: UiMessage) => void
  handleChunk: (chunk: ChatChunk) => void
  clearConversation: () => void
  setState: (state: AssistantState) => void
  toggleSidebar: () => void
  toggleHud: () => void
  toggleVisualizer: () => void
  openSettings: (tab?: string) => void
  closeSettings: () => void
  openSetup: () => void
  closeSetup: () => void
  toast: (message: string, kind?: Toast["kind"]) => void
  dismissToast: (id: string) => void
}

let messageCounter = 0
export const nextId = (prefix = "id"): string => `${prefix}_${Date.now()}_${messageCounter++}`

export const useJarvis = create<JarvisState>((set, get) => ({
  ready: false,
  settings: null,
  providers: [],
  voice: null,
  local: null,
  opencode: null,
  devices: null,

  messages: [],
  streamingText: "",
  streamingProvider: undefined,
  streamingModel: undefined,
  toolCalls: [],
  notice: undefined,
  state: "idle",

  sidebarCollapsed: false,
  hudCollapsed: false,
  visualizerExpanded: false,
  settingsOpen: false,
  setupOpen: false,
  setupTab: "providers",

  toasts: [],

  init: async () => {
    const settings = await window.jarvis.settings.get()
    const providers = await window.jarvis.providers.list()
    set({ settings, providers, ready: true })
    void get().refreshVoice()
    void get().refreshLocal()
    void get().refreshOpencode()
    void get().refreshDevices()
  },

  refreshProviders: async () => {
    const providers = await window.jarvis.providers.list()
    set({ providers })
  },

  refreshVoice: async () => {
    const voice = await window.jarvis.voice.status()
    set({ voice })
  },

  refreshLocal: async () => {
    const local = await window.jarvis.local.status()
    set({ local })
  },

  refreshOpencode: async () => {
    const opencode = await window.jarvis.opencode.status()
    set({ opencode })
  },

  refreshDevices: async () => {
    const devices = await window.jarvis.audio.devices()
    set({ devices })
  },

  updateSettings: async (patch) => {
    const settings = await window.jarvis.settings.update(patch)
    set({ settings })
  },

  addMessage: (message) => {
    set((s) => ({ messages: [...s.messages, message] }))
  },

  handleChunk: (chunk) => {
    switch (chunk.type) {
      case "start":
        set({ streamingText: "", toolCalls: [], notice: undefined, state: "thinking" })
        break
      case "notice":
        set({ notice: chunk.notice })
        break
      case "delta":
        set((s) => ({
          streamingText: s.streamingText + (chunk.text ?? ""),
          streamingProvider: chunk.provider ?? s.streamingProvider,
          streamingModel: chunk.model ?? s.streamingModel
        }))
        break
      case "tool":
        if (chunk.toolCall) {
          set((s) => ({
            toolCalls: [...s.toolCalls, { name: chunk.toolCall!.name }],
            streamingText: s.streamingText
          }))
        }
        break
      case "tool-result":
        if (chunk.toolResult) {
          set((s) => ({
            toolCalls: s.toolCalls.map((t) =>
              t.name === chunk.toolResult!.name ? { ...t, ok: chunk.toolResult!.ok, summary: chunk.toolResult!.summary } : t
            )
          }))
        }
        break
      case "end": {
        const s = get()
        const content = chunk.text ?? s.streamingText
        if (content.trim()) {
          get().addMessage({
            id: nextId("msg"),
            role: "assistant",
            content,
            provider: chunk.provider ?? s.streamingProvider,
            model: chunk.model ?? s.streamingModel,
            toolCalls: s.toolCalls.length ? s.toolCalls.map((t, i) => ({ id: `t${i}`, name: t.name, arguments: {} })) : undefined,
            createdAt: Date.now(),
            durationMs: chunk.durationMs
          })
        }
        set({ streamingText: "", toolCalls: [], notice: undefined, state: "idle" })
        break
      }
      case "error": {
        get().addMessage({
          id: nextId("msg"),
          role: "assistant",
          content: "",
          error: chunk.error ?? "Unknown error",
          createdAt: Date.now()
        })
        set({ streamingText: "", toolCalls: [], notice: undefined, state: "idle" })
        break
      }
    }
  },

  clearConversation: () => set({ messages: [], streamingText: "", toolCalls: [] }),

  setState: (state) => set({ state }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleHud: () => set((s) => ({ hudCollapsed: !s.hudCollapsed })),
  toggleVisualizer: () => set((s) => ({ visualizerExpanded: !s.visualizerExpanded })),

  openSettings: (tab) => set({ settingsOpen: true, setupTab: tab ?? get().setupTab }),
  closeSettings: () => set({ settingsOpen: false }),
  openSetup: () => set({ setupOpen: true }),
  closeSetup: () => set({ setupOpen: false }),

  toast: (message, kind = "info") => {
    const id = nextId("toast")
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 4200)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
