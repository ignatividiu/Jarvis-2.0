import { app, safeStorage } from "electron"
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Settings } from "@shared/types"

const CONFIG_FILE = "jarvis2.config.json"
const KEY_FILE = "jarvis2.keys.json"

export const DEFAULT_SETTINGS: Settings = {
  rotation: {
    strategy: "round-robin",
    order: [],
    maxAttempts: 5,
    temperature: 0.7,
    maxTokens: 2048,
    modelPreference: {},
    retrySameProvider: 1,
    cooldownMs: 45_000,
    halfOpenMs: 5 * 60_000
  },
  persona: {
    name: "JARVIS",
    instructions:
      "You are JARVIS, a composed, witty British AI assistant. Be concise, precise and practical. " +
      "Use British spelling. Never pad answers with filler. When a task needs a tool, use it rather than guessing.",
    speak: true,
    confirm: false
  },
  voice: {
    // The online engine sounds the best and needs no account, so it leads.
    engine: "auto",
    sttEngine: "auto",
    // en-GB-RyanNeural is the closest free voice to the classic JARVIS.
    voiceId: "en-GB-RyanNeural",
    instruct:
      "Speak with dry, understated British wit. Calm, composed and precise — a butler who is always three steps ahead. Never theatrical, never hurried.",
    style: "",
    language: "en-GB",
    browserVoice: "Daniel",
    rate: 1,
    pitch: 1,
    volume: 1,
    sttModel: "onnx-community/whisper-base",
    alwaysOn: false,
    wakeMode: "wake-word",
    // The trigger is a phrase. The leading filler is optional, so
    // "Jarvis, what time is it" also wakes the assistant.
    wakeWord: "Hey jarvis",
    wakeSensitivity: 0.5,
    wakeCue: true,
    silenceTimeoutMs: 1200,
    pushToTalkKey: "Ctrl+Space",
    inputDeviceId: "",
    outputDeviceId: ""
  },
  web: {
    engine: "auto",
    searxngUrl: "",
    maxResults: 6
  },
  local: {
    enabled: true,
    model: "",
    autostart: true
  },
  opencode: {
    enabled: true,
    autostart: true,
    port: 4096,
    directory: ""
  },
  ui: {
    theme: "dark",
    visualizer: "orb",
    accent: "#3ddc97",
    transparency: true,
    compact: false,
    // The chat sits on the left by default; the visualiser is central.
    chatSide: "left",
    visualizerSize: "large"
  },
  remote: {
    enabled: false,
    port: 8765,
    token: "",
    localNetworkOnly: true
  },
  agent: {
    toolsEnabled: true,
    autoRouteCode: false,
    maxToolIterations: 6
  }
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, "utf8")
    // Strip a byte order mark — some editors and shell tools write one, and
    // `JSON.parse` rejects it.
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    if (!text.trim()) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(value, null, 2), "utf8")
  } catch (err) {
    console.error("[jarvis] failed to write config", err)
  }
}

/** Deep merge that keeps arrays from the incoming object (settings are lists, not mergeable). */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue
    const current = out[key]
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      out[key] = deepMerge(current, value)
    } else {
      out[key] = value
    }
  }
  return out as T
}

class ConfigStore {
  private settings: Settings = structuredClone(DEFAULT_SETTINGS)
  private configPath = ""
  private keyPath = ""
  private listeners = new Set<(s: Settings) => void>()

  init(): void {
    this.configPath = join(app.getPath("userData"), CONFIG_FILE)
    this.keyPath = join(app.getPath("userData"), KEY_FILE)

    const stored = readJson<Partial<Settings>>(this.configPath)
    if (stored) {
      this.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), stored)
      this.migrate(stored)
      return
    }

    // A configuration file that cannot be read is kept as a backup rather
    // than being silently replaced — the user's settings are worth more than
    // a tidy folder.
    if (existsSync(this.configPath)) {
      try {
        copyFileSync(this.configPath, `${this.configPath}.broken`)
        console.error(`[jarvis] the settings file could not be read — a copy was saved as ${CONFIG_FILE}.broken`)
      } catch {
        /* the backup is a nicety, not a requirement */
      }
    }

    writeJson(this.configPath, this.settings)
  }

  /**
   * Bring an older configuration up to date.
   *
   * The trigger used to default to the single word "jarvis"; it is now the
   * phrase "Hey jarvis". A configuration that still holds the old default is
   * migrated, but one the user has changed is left alone.
   *
   * The check runs against the file as it was read, not against the merged
   * result — otherwise a section that is merely missing would look present.
   */
  private migrate(stored: Partial<Settings>): void {
    const voice = this.settings.voice
    let changed = false

    if (voice.wakeWord === "jarvis") {
      voice.wakeWord = "Hey jarvis"
      changed = true
    }
    if (voice.wakeCue === undefined) {
      voice.wakeCue = true
      changed = true
    }
    // The tiny model was the weak link in the trigger: it mis-hears names in
    // any noise, and the base model is far more accurate for the same
    // fraction of a second.
    if (voice.sttModel === "onnx-community/whisper-tiny.en") {
      voice.sttModel = "onnx-community/whisper-base"
      changed = true
    }
    if (stored.ui?.chatSide === undefined) {
      this.settings.ui.chatSide = "left"
      changed = true
    }
    if (stored.ui?.visualizerSize === undefined) {
      this.settings.ui.visualizerSize = "large"
      changed = true
    }
    if (stored.remote === undefined) {
      this.settings.remote = { enabled: false, port: 8765, token: "", localNetworkOnly: true }
      changed = true
    }

    if (changed) {
      writeJson(this.configPath, this.settings)
      console.log("[jarvis] the settings were migrated to the current defaults")
    }
  }

  get(): Settings {
    return this.settings
  }

  update(patch: Partial<Settings>): Settings {
    this.settings = deepMerge(this.settings, patch)
    writeJson(this.configPath, this.settings)
    this.listeners.forEach((l) => l(this.settings))
    return this.settings
  }

  reset(): Settings {
    this.settings = structuredClone(DEFAULT_SETTINGS)
    writeJson(this.configPath, this.settings)
    this.listeners.forEach((l) => l(this.settings))
    return this.settings
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /* ── API key vault (encrypted at rest with the OS keychain) ── */

  private readKeys(): Record<string, string> {
    return readJson<Record<string, string>>(this.keyPath) ?? {}
  }

  private writeKeys(keys: Record<string, string>): void {
    writeJson(this.keyPath, keys)
  }

  private encrypt(plain: string): string {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return "enc:" + safeStorage.encryptString(plain).toString("base64")
      }
    } catch {
      /* fall through to plaintext */
    }
    return "plain:" + plain
  }

  private decrypt(stored: string): string {
    try {
      if (stored.startsWith("enc:")) {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"))
      }
      if (stored.startsWith("plain:")) return stored.slice(6)
    } catch {
      return ""
    }
    return ""
  }

  setApiKey(providerId: string, key: string): void {
    const keys = this.readKeys()
    if (!key) delete keys[providerId]
    else keys[providerId] = this.encrypt(key)
    this.writeKeys(keys)
  }

  getApiKey(providerId: string): string {
    const stored = this.readKeys()[providerId]
    if (!stored) return ""
    return this.decrypt(stored)
  }

  hasApiKey(providerId: string): boolean {
    return Boolean(this.readKeys()[providerId])
  }

  clearApiKey(providerId: string): void {
    const keys = this.readKeys()
    delete keys[providerId]
    this.writeKeys(keys)
  }
}

export const config = new ConfigStore()
