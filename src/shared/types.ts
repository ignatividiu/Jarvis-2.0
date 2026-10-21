/**
 * Shared IPC contract between the Electron main process and the renderer.
 * Keep this file free of runtime imports so it can be bundled into both sides.
 */

/* ──────────────────────────  Providers  ────────────────────────── */

export type ProviderKind = "cloud" | "local"

export interface ProviderModel {
  id: string
  name?: string
  /** Context window in tokens, when known. */
  context?: number
  /** True when the model can be called at zero cost. */
  free?: boolean
  /** Rough capability hint used to pick a model for a given job. */
  capabilities?: ("chat" | "code" | "reasoning" | "vision" | "audio")[]
  /** True when the model id was read from the live catalogue. */
  live?: boolean
}

export interface ProviderDefinition {
  id: string
  label: string
  kind: ProviderKind
  /** OpenAI-compatible base URL (no trailing slash). */
  baseUrl: string
  /** Environment variables that may hold the API key. */
  envKeys: string[]
  /** Where the user obtains a free key. */
  signupUrl?: string
  /** True when the provider works with no key at all. */
  keyless?: boolean
  /** True when the endpoint accepts OpenAI-style `tools` arrays. */
  supportsTools?: boolean
  /** True when the endpoint accepts a `reasoning`/`thinking` budget. */
  supportsReasoning?: boolean
  /** Hardcoded model list; used only until live discovery succeeds. */
  models: ProviderModel[]
  /** Discover models from `${baseUrl}/models` at runtime. */
  discoverModels?: boolean
  /** Alternative path for discovery when `/models` is not OpenAI-shaped. */
  modelsPath?: string
  notes?: string
  /** Rough requests-per-minute of the free tier, when published. */
  rpm?: number
  /** Minimum gap between two requests, in milliseconds. */
  minIntervalMs?: number
  /** Free tier needs a card on file. */
  requiresCard?: boolean
  tags?: string[]
}

export interface ProviderStatus {
  id: string
  label: string
  kind: ProviderKind
  configured: boolean
  /** Why it is not configured, in human words. */
  reason?: string
  models: ProviderModel[]
  healthy?: boolean
  lastError?: string
  /** Unix ms of the last successful call. */
  lastUsed?: number
  /** Unix ms until which the provider is quarantined after a failure. */
  cooldownUntil?: number
  calls: number
  failures: number
  totalLatencyMs: number
  avgLatencyMs: number
  signupUrl?: string
  keyless?: boolean
  requiresCard?: boolean
  notes?: string
  rpm?: number
  supportsTools?: boolean
  envKeys: string[]
  /** True when the model list came from the live endpoint. */
  liveModels?: boolean
  /** Seconds the provider must wait between requests (free-tier pacing). */
  minIntervalMs?: number
}

export type RotationStrategy = "round-robin" | "priority" | "latency" | "quota-aware" | "random"

export interface RotationConfig {
  strategy: RotationStrategy
  /** Comma separated provider ids; empty means "all configured providers". */
  order: string[]
  /** Maximum providers tried for a single request. */
  maxAttempts: number
  /** Temperature applied to chat requests. */
  temperature: number
  /** Max tokens for chat requests. */
  maxTokens: number
  /** Preferred model per provider id, empty string = provider default. */
  modelPreference: Record<string, string>
  /** Retry the same provider after a transient failure. */
  retrySameProvider: number
  /** Pause this long after a provider fails, before trying it again. */
  cooldownMs: number
  /** Re-probe a quarantined provider after this long. */
  halfOpenMs: number
}

/* ──────────────────────────  Chat  ────────────────────────── */

export type MessageRole = "user" | "assistant" | "system" | "tool"

export interface ChatMessage {
  role: MessageRole
  content: string
  /** Tool call id when role === "tool". */
  toolCallId?: string
  /** Tool name when role === "tool". */
  name?: string
  /** Native tool calls attached to an assistant turn. */
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface UiMessage {
  id: string
  role: MessageRole
  content: string
  /** True while the assistant is still streaming. */
  streaming?: boolean
  /** Provider that produced this message. */
  provider?: string
  model?: string
  /** Tool calls made while producing this message. */
  toolCalls?: ToolCall[]
  error?: string
  createdAt: number
  /** Elapsed milliseconds. */
  durationMs?: number
  /** True when the message came from the microphone. */
  spoken?: boolean
}

export interface ChatHistoryEntry {
  role: "user" | "assistant"
  content: string
}

export interface ChatRequest {
  text: string
  /** Conversation history (excluding the new text). */
  history?: ChatHistoryEntry[]
  /** Which capabilities to expose. */
  tools?: string[]
  /** Working directory for the code agent. */
  directory?: string
  /** Use the OpenCode coding agent instead of the plain chat model. */
  mode?: "chat" | "code" | "auto"
  /** True when the prompt arrived through the microphone. */
  spoken?: boolean
}

export interface ChatChunk {
  type: "start" | "delta" | "tool" | "tool-result" | "notice" | "end" | "error" | "speak"
  text?: string
  provider?: string
  model?: string
  toolCall?: ToolCall
  toolResult?: { name: string; ok: boolean; summary: string }
  /** A short status note, e.g. "waiting for the free pool". */
  notice?: string
  error?: string
  durationMs?: number
  /** A generated speech clip that the renderer should play straight away. */
  clipId?: string
  /** The mime type of the clip. */
  mimeType?: string
}

/* ──────────────────────────  Voice  ────────────────────────── */

/** Speech synthesis engines, in the order JARVIS prefers them. */
export type TtsEngine = "auto" | "edge" | "piper" | "browser"

/** Speech recognition engines, in the order JARVIS prefers them. */
export type SttEngine = "auto" | "whisper" | "browser"

/** How always-on listening decides that it should answer. */
export type WakeMode = "wake-word" | "open" | "off"

export interface VoiceOption {
  /** Engine-agnostic identifier, e.g. "en-GB-RyanNeural". */
  id: string
  /** Human readable name. */
  name: string
  /** BCP-47 language tag. */
  language: string
  /** "male" | "female" | "neutral" */
  gender: "male" | "female" | "neutral"
  /** Which engine produces this voice. */
  engine: TtsEngine
  /** True when the voice is a good JARVIS match. */
  jarvisLike?: boolean
  /** Expressive styles the voice can perform (Edge voices only). */
  styles?: string[]
  /** True when the voice must be downloaded before it can be used. */
  local?: boolean
  /** True when the voice is already installed on this machine. */
  installed?: boolean
  /** Approximate download size for local voices. */
  sizeBytes?: number
}

export interface SpeechModelStatus {
  id: string
  label: string
  /** Approximate download size in bytes. */
  sizeBytes: number
  /** True when the model is present in the local cache. */
  installed: boolean
  /** True while the model is downloading. */
  downloading: boolean
  /** 0-100 while downloading. */
  progress: number
  description: string
}

export interface VoiceStatus {
  /** The engine that will actually be used right now. */
  activeEngine: TtsEngine
  /** The recognition engine that will actually be used right now. */
  activeSttEngine: SttEngine
  /** Every voice the user can pick, across all engines. */
  voices: VoiceOption[]
  /** Speech models available for local recognition. */
  models: SpeechModelStatus[]
  /** True when the local Piper runtime is installed. */
  piperInstalled: boolean
  /** True when the Piper binary is present on disk. */
  piperBinaryPresent: boolean
  /** True when the Edge (online) engine answered a probe. */
  edgeReachable: boolean
  /** True when a local Whisper model is ready. */
  whisperReady: boolean
  /** The recognised engine currently loaded in memory. */
  whisperModel?: string
  /** Selected voice id. */
  activeVoiceId?: string
  /** Selected voice name. */
  activeVoiceName?: string
  /** Human readable summary of the chain, e.g. "Edge TTS → Whisper (base)". */
  summary: string
  error?: string
}

export interface SpeakRequest {
  text: string
  /** Voice id; omit to use the configured voice. */
  voiceId?: string
  language?: string
  /** Edge "express-as" style, e.g. "calm" or "newscast". */
  style?: string
  /** Extra delivery instruction appended to the prosody. */
  instruct?: string
}

export interface SpeakResult {
  ok: boolean
  /** The engine that produced the audio. */
  engine: TtsEngine
  /** Identifier of the cached clip, playable through `jarvismedia://speech/<id>`. */
  clipId?: string
  mimeType?: string
  /** Size of the generated audio in bytes. */
  bytes?: number
  durationMs?: number
  error?: string
}

export interface TranscribeRequest {
  /** Mono 16 kHz PCM samples. */
  samples: Float32Array
  /** Sample rate of `samples` (must be 16000 for Whisper). */
  sampleRate: number
  language?: string
  /** Force a particular recognition engine. */
  engine?: SttEngine
}

export interface TranscribeResult {
  ok: boolean
  text: string
  engine: SttEngine
  /** How long the recognition took. */
  durationMs?: number
  error?: string
}

/* ──────────────────────────  Audio devices  ────────────────────────── */

export interface AudioDevice {
  deviceId: string
  label: string
  kind: "input" | "output"
  /** True for the system default device. */
  isDefault?: boolean
}

export interface AudioDevices {
  inputs: AudioDevice[]
  outputs: AudioDevice[]
  /** True once the user has granted microphone permission. */
  permitted: boolean
  /** True when the platform can route audio to a chosen output. */
  canSelectOutput: boolean
  error?: string
}

/* ──────────────────────────  Remote access  ────────────────────────── */

export interface RemoteStatus {
  /** True when the server is listening. */
  running: boolean
  /** The port it listens on. */
  port: number
  /** The addresses a remote device can use. */
  addresses: string[]
  /** The token a remote device has to present. */
  token: string
  /** True when the request came from this machine. */
  enabled: boolean
  /** Only allow requests from the local network. */
  localNetworkOnly: boolean
  /** The last error, if the server could not start. */
  error?: string
}

/* ──────────────────────────  Local models  ────────────────────────── */

export interface LocalModel {
  name: string
  sizeBytes: number
  parameterSize?: string
  quantization?: string
  family?: string
  modifiedAt?: string
  /** Installed locally. */
  installed: boolean
  /** Available in the catalogue but not downloaded. */
  available: boolean
  description?: string
  /** Recommended for a quick first install. */
  recommended?: boolean
  /** Low VRAM / CPU friendly. */
  light?: boolean
}

export interface LocalStatus {
  /** An Ollama-compatible server is reachable. */
  available: boolean
  /** The Ollama binary is present on disk (even if the server is down). */
  installed: boolean
  version?: string
  baseUrl: string
  models: LocalModel[]
  /** Error message if something went wrong. */
  error?: string
  /** True while a download is in progress. */
  busy?: boolean
  /** Progress of the active download, 0-100. */
  progress?: number
  /** Which backend: ollama | lmstudio | llamacpp | none */
  backend: "ollama" | "lmstudio" | "llamacpp" | "none"
  /** Models that can be installed, with sizes. */
  catalogue: CatalogueModel[]
}

export interface CatalogueModel {
  name: string
  sizeBytes: number
  parameterSize?: string
  quantization?: string
  description: string
  /** Recommended for a quick first install. */
  recommended?: boolean
  /** Low VRAM / CPU friendly. */
  light?: boolean
  tag: string
}

/* ──────────────────────────  Web search  ────────────────────────── */

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

export interface SearchResponse {
  ok: boolean
  query: string
  results: SearchResult[]
  /** Which backend answered. */
  engine?: string
  error?: string
}

/* ──────────────────────────  OpenCode  ────────────────────────── */

export interface OpenCodeStatus {
  available: boolean
  running: boolean
  baseUrl: string
  version?: string
  directory?: string
  sessions: OpenCodeSession[]
  error?: string
  /** Path to the opencode binary that was located. */
  binaryPath?: string
}

export interface OpenCodeSession {
  id: string
  title?: string
  created?: number
  updated?: number
}

/* ──────────────────────────  Settings  ────────────────────────── */

/** Which side of the window the chat column sits on. */
export type ChatSide = "left" | "right"

/** How much room the visualiser takes. */
export type VisualizerSize = "large" | "medium" | "small"

export interface Settings {
  rotation: RotationConfig
  persona: {
    name: string
    instructions: string
    /** Speak responses aloud. */
    speak: boolean
    /** Read the user back before answering. */
    confirm: boolean
  }
  voice: {
    /** Speech synthesis engine. */
    engine: TtsEngine
    /** Speech recognition engine. */
    sttEngine: SttEngine
    /** Voice id used for replies. */
    voiceId: string
    /** Extra delivery instruction for the assistant's voice. */
    instruct: string
    /** Edge express-as style. */
    style: string
    language: string
    /** Browser speech fallback voice name. */
    browserVoice: string
    /** Speaking rate, 0.5 – 2. */
    rate: number
    /** Pitch, 0 – 2. */
    pitch: number
    /** Volume, 0 – 1. */
    volume: number
    /** Local speech recognition model id. */
    sttModel: string
    /** Always listen for the wake word. */
    alwaysOn: boolean
    /** What wakes the assistant up. */
    wakeMode: WakeMode
    /**
     * The phrase that wakes the assistant up.
     *
     * It may be more than one word — the default is "Hey jarvis". The
     * leading filler is optional, so "Jarvis, what time is it" works too.
     */
    wakeWord: string
    /** Higher = triggers more easily. */
    wakeSensitivity: number
    /** Play a short confirmation tone when the wake word is heard. */
    wakeCue: boolean
    /** Silence after the last word that ends an utterance, in ms. */
    silenceTimeoutMs: number
    /** Keyboard shortcut that pushes to talk, e.g. "Ctrl+Space". */
    pushToTalkKey: string
    /** Selected microphone device id. Empty = system default. */
    inputDeviceId: string
    /** Selected speaker device id. Empty = system default. */
    outputDeviceId: string
  }
  web: {
    engine: "auto" | "duckduckgo" | "wikipedia" | "tavily" | "brave" | "searxng" | "opencode"
    searxngUrl: string
    maxResults: number
  }
  local: {
    enabled: boolean
    /** Preferred local model tag. */
    model: string
    /** Autostart the local runtime with the app. */
    autostart: boolean
  }
  opencode: {
    enabled: boolean
    autostart: boolean
    port: number
    directory: string
  }
  ui: {
    theme: "dark" | "light" | "system"
    visualizer: string
    accent: string
    /** Window transparency for the HUD look. */
    transparency: boolean
    compact: boolean
    /** Which side the chat column sits on. */
    chatSide: ChatSide
    /** How much room the visualiser takes. */
    visualizerSize: VisualizerSize
  }
  remote: {
    /** Allow the assistant to be reached from outside this machine. */
    enabled: boolean
    /** The port the remote server listens on. */
    port: number
    /** The pairing token a remote device has to present. */
    token: string
    /** Only answer requests that come from this network. */
    localNetworkOnly: boolean
  }
  agent: {
    /** Allow the agent to use tools. */
    toolsEnabled: boolean
    /** Route coding questions to OpenCode automatically. */
    autoRouteCode: boolean
    maxToolIterations: number
  }
}

export interface AppInfo {
  version: string
  platform: string
  arch: string
  electron: string
  node: string
  chrome: string
  userDataPath: string
  homePath: string
  ffmpegPath?: string
}

/* ──────────────────────────  Setup  ────────────────────────── */

export type SetupStage = "idle" | "checking" | "downloading" | "installing" | "pulling" | "done" | "error" | "skipped"

export interface SetupProgress {
  stage: SetupStage
  /** Component being set up. */
  component: "ollama" | "piper" | "models" | "speech" | "providers" | "search" | "voice"
  /** 0-100 */
  percent: number
  message: string
  /** Free-form extra detail. */
  detail?: string
  error?: string
  /** Total bytes / downloaded bytes for the active transfer. */
  bytes?: { total: number; received: number }
}

export interface SetupResult {
  ok: boolean
  ollama: LocalStatus | null
  voice: VoiceStatus | null
  providers: ProviderStatus[]
  log: string[]
}

export interface ProviderTestResult {
  ok: boolean
  providerId: string
  model?: string
  latencyMs?: number
  reply?: string
  error?: string
}

/* ──────────────────────────  API surface  ────────────────────────── */

export interface JarvisApi {
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<void>
    /** Development aid — returns the prompt to send on launch, if any. */
    demoPrompt(): Promise<string>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    reset(): Promise<Settings>
    setApiKey(providerId: string, key: string): Promise<ProviderStatus[]>
    clearApiKey(providerId: string): Promise<ProviderStatus[]>
    hasApiKey(providerId: string): Promise<boolean>
  }
  providers: {
    list(): Promise<ProviderStatus[]>
    discover(providerId: string): Promise<ProviderStatus[]>
    test(providerId: string, model?: string): Promise<ProviderTestResult>
    /** Probe every configured provider and report which ones answer. */
    testAll(): Promise<ProviderTestResult[]>
  }
  chat: {
    send(request: ChatRequest): Promise<{ ok: boolean; error?: string }>
    cancel(): Promise<void>
  }
  voice: {
    status(): Promise<VoiceStatus>
    speak(request: SpeakRequest): Promise<SpeakResult>
    stop(): Promise<void>
    transcribe(request: TranscribeRequest): Promise<TranscribeResult>
    /** Speech models available for local recognition. */
    models(): Promise<SpeechModelStatus[]>
    /** Download a speech recognition model. */
    downloadModel(modelId: string): Promise<{ ok: boolean; message: string }>
    /** Download the local Piper runtime and a voice. */
    installPiper(voiceId?: string): Promise<{ ok: boolean; message: string }>
    /** Remove the local Piper runtime. */
    uninstallPiper(): Promise<{ ok: boolean; message: string }>
    /** Open the download page for the local speech engine. */
    openPiper(): Promise<void>
  }
  audio: {
    /** List microphones and speakers. */
    devices(): Promise<AudioDevices>
  }
  remote: {
    /** The current state of the remote-access server. */
    status(): Promise<RemoteStatus>
    /** Start or stop the server. */
    start(): Promise<RemoteStatus>
    stop(): Promise<RemoteStatus>
    /** Generate a new pairing token. */
    rotateToken(): Promise<RemoteStatus>
    /** The address a remote device should point at. */
    addresses(): Promise<string[]>
  }
  local: {
    status(): Promise<LocalStatus>
    install(): Promise<{ ok: boolean; message: string }>
    pull(tag: string): Promise<LocalStatus>
    remove(tag: string): Promise<LocalStatus>
    restart(): Promise<LocalStatus>
  }
  websearch: {
    search(query: string, engine?: string): Promise<SearchResponse>
  }
  opencode: {
    status(): Promise<OpenCodeStatus>
    start(): Promise<OpenCodeStatus>
    prompt(text: string, directory?: string): Promise<{ ok: boolean; output?: string; error?: string }>
    sessions(): Promise<OpenCodeSession[]>
    setDirectory(directory: string): Promise<OpenCodeStatus>
  }
  setup: {
    run(options: { ollama: boolean; models: boolean; voice: boolean; speech: boolean }): Promise<SetupResult>
    status(): Promise<SetupProgress>
  }
  events: {
    on(channel: string, handler: (payload: unknown) => void): () => void
  }
}
