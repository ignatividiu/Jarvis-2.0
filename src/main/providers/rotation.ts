import type {
  ChatMessage,
  ProviderModel,
  ProviderStatus,
  RotationConfig,
  RotationStrategy
} from "@shared/types"
import { config } from "../store"
import { createLogger } from "../logger"
import { fetchJson } from "../net"
import { getProvider, PROVIDERS } from "./registry"
import {
  friendlyProviderError,
  isRateLimit,
  LlmError,
  parseTextToolCall as parseTextTool,
  retryAfterMs,
  streamChat,
  type LlmChunk
} from "./llm"

const log = createLogger("rotation")

/**
 * Provider health and the rotation engine.
 *
 * Every provider is tracked with a small circuit breaker:
 *
 *  - **closed** — the provider works, it is used normally;
 *  - **open** — the provider just failed, it is skipped for a while;
 *  - **half-open** — the cooldown has expired, so one probe is allowed
 *    through to find out whether the provider has recovered.
 *
 * Without that, a single broken provider could eat every attempt and leave
 * the assistant with nothing to say.
 */

interface Health {
  calls: number
  failures: number
  totalLatencyMs: number
  lastUsed?: number
  lastError?: string
  /** Until when the provider is skipped. */
  cooldownUntil?: number
  /** When the provider entered the open state — used for the half-open probe. */
  openedAt?: number
  healthy: boolean
  models: ProviderModel[]
  /** True when the model list came from the live endpoint. */
  liveModels: boolean
  /** Timestamp of the last request, used to pace keyless providers. */
  lastRequestAt?: number
}

const health = new Map<string, Health>()

function healthOf(id: string): Health {
  let h = health.get(id)
  if (!h) {
    h = { calls: 0, failures: 0, totalLatencyMs: 0, healthy: true, models: [], liveModels: false }
    health.set(id, h)
  }
  return h
}

/* ─────────────────────────  Key resolution  ───────────────────────── */

/**
 * Availability of the local runtimes.
 *
 * A local provider is only "configured" when its server is actually
 * listening, otherwise the rotation would burn attempts on a dead endpoint.
 */
const localAvailability = new Map<string, boolean>([
  ["ollama", false],
  ["lmstudio", false],
  ["llamacpp", false]
])

/** The models each local runtime currently has installed. */
const localModels = new Map<string, string[]>()

const LOCAL_ENDPOINTS: Record<string, string> = {
  ollama: "http://127.0.0.1:11434/api/tags",
  lmstudio: "http://127.0.0.1:1234/v1/models",
  llamacpp: "http://127.0.0.1:8080/v1/models"
}

let localProbeAt = 0

/**
 * Ask a local runtime which models it has.
 *
 * A runtime that is running but has no model installed cannot answer
 * anything, so the model list is needed to decide whether the provider is
 * usable at all.
 */
async function fetchLocalModels(id: string): Promise<string[] | null> {
  try {
    if (id === "ollama") {
      const res = await fetchJson<{ models?: Array<{ name?: string }> }>(LOCAL_ENDPOINTS.ollama, {
        timeoutMs: 2500
      })
      return (res.models ?? []).map((m) => m.name ?? "").filter(Boolean)
    }
    const res = await fetchJson<{ data?: Array<{ id?: string }> }>(LOCAL_ENDPOINTS[id], {
      timeoutMs: 2500
    })
    return (res.data ?? []).map((m) => m.id ?? "").filter(Boolean)
  } catch {
    return null
  }
}

/** Probe the local runtimes. Cheap, and only re-runs every few seconds. */
export async function refreshLocalProviders(force = false): Promise<void> {
  if (!force && localProbeAt && Date.now() - localProbeAt < 5000) return
  localProbeAt = Date.now()
  await Promise.all(
    Object.entries(LOCAL_ENDPOINTS).map(async ([id]) => {
      const models = await fetchLocalModels(id)
      localAvailability.set(id, models !== null)
      if (!models) return

      localModels.set(id, models)

      // The installed models are the live catalogue for a local runtime, so
      // the settings and the interface show the truth.
      const h = healthOf(id)
      h.models = models.map((name) => ({ id: name, name, free: true, live: true }))
      h.liveModels = true
    })
  )
}

/**
 * Resolve the API key for a provider.
 * Order: encrypted vault → environment variables → (keyless) empty string.
 */
export function resolveApiKey(providerId: string): { key: string; source: string } {
  const provider = getProvider(providerId)
  if (!provider) return { key: "", source: "unknown" }

  const stored = config.getApiKey(providerId)
  if (stored) return { key: stored, source: "vault" }

  for (const envKey of provider.envKeys) {
    const value = process.env[envKey]
    if (value) {
      // OLLAMA_HOST holds a host, not a credential.
      if (providerId === "ollama" && envKey === "OLLAMA_HOST") continue
      return { key: value, source: `env:${envKey}` }
    }
  }
  return { key: "", source: provider.keyless ? "keyless" : "missing" }
}

export function isProviderConfigured(providerId: string): boolean {
  const provider = getProvider(providerId)
  if (!provider) return false
  if (provider.kind === "local") {
    if (!localAvailability.get(providerId)) return false
    // A runtime that is running but has no model installed cannot answer
    // anything. Asking it anyway produces a "model not found" error.
    const models = localModels.get(providerId)
    return !models || models.length > 0
  }
  const { key, source } = resolveApiKey(providerId)
  if (key) return true
  return provider.keyless === true && source === "keyless"
}

export function providerReason(providerId: string): string | undefined {
  const provider = getProvider(providerId)
  if (!provider) return "Unknown provider"
  if (isProviderConfigured(providerId)) return undefined
  if (provider.kind === "local") {
    if (!localAvailability.get(providerId)) {
      return providerId === "ollama"
        ? "Ollama is not running. Install it from the Local models tab."
        : `${provider.label} is not running on its default port.`
    }
    // The runtime is up, but there is nothing for it to run.
    return providerId === "ollama"
      ? "Ollama is running, but no model is installed. Download one from the Local models tab."
      : `${provider.label} is running, but no model is loaded.`
  }
  if (provider.keyless) return "No key — the shared free pool is busy. Add a key for reliability."
  const envNames = provider.envKeys.join(" or ")
  return `Add a free API key (env ${envNames}) or paste one in Settings.`
}

/* ─────────────────────────  Model discovery  ───────────────────────── */

interface OpenAiModelList {
  data?: Array<{ id?: string; context_length?: number; owned_by?: string; pricing?: Record<string, string> }>
  models?: Array<{ id?: string; context_length?: number; owned_by?: string; pricing?: Record<string, string> }>
}

/**
 * Pull the model list out of a provider response.
 *
 * Most providers answer with `{ "data": [...] }`, but some — GitHub Models
 * among them — answer with a bare array. Both shapes are accepted.
 */
function readModelArray(payload: unknown): Array<{
  id?: string
  context_length?: number
  pricing?: Record<string, string>
}> {
  if (Array.isArray(payload)) return payload as Array<{ id?: string }>
  if (payload && typeof payload === "object") {
    const list = payload as OpenAiModelList
    if (Array.isArray(list.data)) return list.data
    if (Array.isArray(list.models)) return list.models
  }
  return []
}

/** Model names that are never a chat model. */
const NOT_CHAT = /embedding|whisper|tts|moderation|rerank|stable-diffusion|clip|vision|audio|speech/i

/**
 * Discover the models a provider currently serves.
 *
 * The live list always wins over the hard-coded fallback, because free model
 * names are renamed and retired constantly.
 */
export async function discoverModels(providerId: string, force = false): Promise<ProviderModel[]> {
  const provider = getProvider(providerId)
  if (!provider) return []

  const h = healthOf(providerId)
  if (!force && h.liveModels && h.models.length) return h.models

  const { key } = resolveApiKey(providerId)
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {}

  try {
    if (providerId === "openrouter") {
      const data = await fetchJson<OpenAiModelList>(
        `${provider.baseUrl}${provider.modelsPath ?? "/models"}`,
        { headers, timeoutMs: 20_000 }
      )
      const list = readModelArray(data)
      const models = list
        .filter((m) => {
          if (!m.id) return false
          // Skip music, audio, embedding and moderation endpoints.
          if (/lyria|audio|whisper|embed|mod|guard|clip/i.test(m.id)) return false
          const prompt = Number(m.pricing?.prompt ?? 1)
          const completion = Number(m.pricing?.completion ?? 1)
          return m.id.endsWith(":free") || prompt === 0
        })
        .map((m) => ({
          id: m.id as string,
          name: (m.id as string).replace(/:free$/, "").split("/").pop()?.replace(/-/g, " "),
          context: m.context_length,
          free: true,
          live: true,
          capabilities: ["chat"] as ProviderModel["capabilities"]
        }))

      if (models.length) {
        h.models = models
        h.liveModels = true
      }
      return models.length ? models : h.models
    }

    const url = `${provider.baseUrl.replace(/\/$/, "")}${provider.modelsPath ?? "/models"}`
    const data = await fetchJson<unknown>(url, { headers, timeoutMs: 15_000 })
    const list = readModelArray(data)

    const models: ProviderModel[] = list
      .filter((m) => m.id && !NOT_CHAT.test(m.id))
      .map((m) => ({
        id: m.id as string,
        name: (m.id as string).split("/").pop()?.replace(/-/g, " "),
        context: m.context_length,
        free: true,
        live: true,
        capabilities: ["chat"] as ProviderModel["capabilities"]
      }))

    // Ollama exposes richer metadata on /api/tags.
    if (providerId === "ollama") {
      const tags = await fetchJson<{ models?: Array<{ name: string; details?: Record<string, unknown> }> }>(
        "http://127.0.0.1:11434/api/tags",
        { timeoutMs: 8000 }
      )
      const extra = (tags.models ?? []).map((m) => ({
        id: m.name,
        name: m.name,
        free: true,
        live: true,
        capabilities: ["chat"] as ProviderModel["capabilities"]
      }))
      const seen = new Set(models.map((m) => m.id))
      const merged = [...models, ...extra.filter((m) => !seen.has(m.id))]
      h.models = merged
      h.liveModels = merged.length > 0
      if (merged.length) localModels.set(providerId, merged.map((m) => m.id))
      return merged.length ? merged : h.models
    }

    if (models.length) {
      h.models = models
      h.liveModels = true
      return models
    }

    log.info(`${providerId} returned no chat models`)
    return h.models.length ? h.models : provider.models
  } catch (err) {
    log.warn(`model discovery failed for ${providerId}`, String(err))
    return h.models.length ? h.models : provider.models
  }
}

/* ─────────────────────────  Status  ───────────────────────── */

export async function listProviderStatus(): Promise<ProviderStatus[]> {
  await refreshLocalProviders()
  return PROVIDERS.map((provider) => {
    const h = healthOf(provider.id)
    const configured = isProviderConfigured(provider.id)
    return {
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      configured,
      reason: providerReason(provider.id),
      models: h.models.length ? h.models : provider.models,
      healthy: h.healthy,
      lastError: h.lastError,
      lastUsed: h.lastUsed,
      cooldownUntil: h.cooldownUntil,
      calls: h.calls,
      failures: h.failures,
      totalLatencyMs: h.totalLatencyMs,
      avgLatencyMs: h.calls ? Math.round(h.totalLatencyMs / h.calls) : 0,
      signupUrl: provider.signupUrl,
      keyless: provider.keyless,
      requiresCard: provider.requiresCard,
      notes: provider.notes,
      rpm: provider.rpm,
      supportsTools: provider.supportsTools,
      envKeys: provider.envKeys,
      liveModels: h.liveModels,
      minIntervalMs: provider.minIntervalMs
    }
  })
}

/* ─────────────────────────  Selection  ───────────────────────── */

function activePool(cfg: RotationConfig): string[] {
  const configured = PROVIDERS.filter((p) => isProviderConfigured(p.id)).map((p) => p.id)
  if (!cfg.order.length) return configured
  const ordered = cfg.order.filter((id) => configured.includes(id))
  const rest = configured.filter((id) => !cfg.order.includes(id))
  return [...ordered, ...rest]
}

/**
 * Is the provider currently quarantined?
 *
 * The cooldown expires after `cooldownMs`; after that the provider is
 * allowed one probe through so it can prove it has recovered.
 */
function inCooldown(id: string, cfg: RotationConfig): boolean {
  const h = healthOf(id)
  if (!h.cooldownUntil) return false
  if (h.cooldownUntil > Date.now()) return true

  // The cooldown has expired — half-open. One attempt is allowed.
  const halfOpen = cfg.halfOpenMs ?? 5 * 60_000
  if (!h.openedAt || Date.now() - h.openedAt < halfOpen) {
    // Still inside the half-open window but past the cooldown: allow a probe.
    return false
  }
  return true
}

/** Providers that were used too recently for their free tier's pace. */
function throttled(id: string): boolean {
  const provider = getProvider(id)
  if (!provider?.minIntervalMs) return false
  const h = healthOf(id)
  if (!h.lastRequestAt) return false
  return Date.now() - h.lastRequestAt < provider.minIntervalMs
}

/**
 * The model to use for a provider.
 *
 * Returns an empty string when the provider serves no known model — a
 * made-up name such as "default" would only produce a confusing
 * "model not found" error, so the caller skips the provider instead.
 */
export function defaultModelFor(providerId: string): string {
  const provider = getProvider(providerId)
  const pref = config.get().rotation.modelPreference[providerId]
  const h = healthOf(providerId)
  const local = localModels.get(providerId) ?? []

  // The models this provider is known to serve.
  const known: string[] = [
    ...h.models.map((m) => m.id),
    ...local,
    ...(provider?.models.map((m) => m.id) ?? [])
  ]

  if (pref) {
    // A preference is only honoured when the model really exists.
    if (!known.length || known.includes(pref)) return pref
  }

  if (h.models.length) return h.models[0].id
  if (local.length) return local[0]
  if (provider?.models.length) return provider.models[0].id
  return ""
}

/**
 * Order the candidate providers according to the strategy.
 */
function orderCandidates(ids: string[], cfg: RotationConfig): string[] {
  switch (cfg.strategy) {
    case "priority":
      return ids
    case "latency":
      return [...ids].sort(
        (a, b) =>
          healthOf(a).totalLatencyMs / (healthOf(a).calls || 1) -
          healthOf(b).totalLatencyMs / (healthOf(b).calls || 1)
      )
    case "random":
      return [...ids].sort(() => Math.random() - 0.5)
    case "quota-aware":
    case "round-robin":
    default: {
      // Round robin over the pool.
      const cursor = rotationCursor
      rotationCursor = (rotationCursor + 1) % Math.max(ids.length, 1)
      const rotated = ids.slice(cursor % ids.length).concat(ids.slice(0, cursor % ids.length))
      return rotated
    }
  }
}

/**
 * Choose the next provider to try.
 *
 * `exclude` holds providers that already failed this request. A provider
 * that serves no known model is skipped, so the rotation moves on to the
 * next one instead of asking for a model that does not exist.
 */
export function selectProvider(
  cfg: RotationConfig,
  exclude: Set<string>,
  preferredModel?: string
): { id: string; model: string } | null {
  const pool = activePool(cfg).filter((id) => !exclude.has(id))
  if (!pool.length) return null

  // Providers that are past their cooldown but not yet allowed to probe.
  const available = pool.filter((id) => !inCooldown(id, cfg))
  const throttledOut = available.filter((id) => throttled(id))
  const candidates = available.filter((id) => !throttled(id))

  // Everything is busy or throttled — fall back to the throttled ones so a
  // request is never simply dropped.
  const list = candidates.length ? candidates : throttledOut.length ? throttledOut : available
  if (!list.length) return null

  for (const id of orderCandidates(list, cfg)) {
    // A provider with no model cannot be asked anything. It is skipped
    // rather than called with a made-up model name.
    // The preference is resolved through `defaultModelFor`, which checks
    // that the chosen model actually exists.
    const model = preferredModel || defaultModelFor(id)
    if (!model) {
      log.warn(`${id} serves no known model — skipping it`)
      continue
    }
    return { id, model }
  }

  return null
}

let rotationCursor = 0

function markSuccess(id: string, latencyMs: number): void {
  const h = healthOf(id)
  h.calls++
  h.totalLatencyMs += latencyMs
  h.lastUsed = Date.now()
  h.lastRequestAt = Date.now()
  h.healthy = true
  h.lastError = undefined
  h.cooldownUntil = undefined
  h.openedAt = undefined
}

function markFailure(id: string, error: string, cooldownMs: number): void {
  const h = healthOf(id)
  h.calls++
  h.failures++
  h.lastUsed = Date.now()
  h.lastRequestAt = Date.now()
  h.healthy = false
  h.lastError = error
  h.cooldownUntil = Date.now() + cooldownMs
  h.openedAt = Date.now()
}

/* ─────────────────────────  Execution  ───────────────────────── */

export interface RotationAttempt {
  provider: string
  model: string
  latencyMs: number
}

export interface RotationResult {
  text: string
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  provider: string
  model: string
  finishReason?: string
  usage?: { prompt?: number; completion?: number; total?: number }
  attempts: RotationAttempt[]
}

/**
 * Run a chat completion, rotating across free providers until one answers.
 * Yields streamed deltas as they arrive.
 */
export async function* runRotated(
  messages: ChatMessage[],
  options: {
    cfg: RotationConfig
    signal?: AbortSignal
    tools?: Parameters<typeof streamChat>[0]["tools"]
    useTools?: boolean
    preferredModel?: string
    /**
     * Builds the message list for a specific provider. Some free endpoints
     * reject `role: "tool"` messages, so the conversation is reshaped to
     * match the capabilities of whichever provider is about to be called.
     */
    messagesFor?: (supportsTools: boolean) => ChatMessage[]
  }
): AsyncGenerator<LlmChunk & { provider?: string; model?: string; notice?: string }> {
  const { cfg, signal, tools, useTools, preferredModel, messagesFor } = options
  const tried = new Set<string>()
  const attempts: RotationAttempt[] = []
  const maxAttempts = Math.max(1, Math.min(cfg.maxAttempts || 4, 10))
  let lastError = "No configured provider."
  let rateLimitRetried = false

  await refreshLocalProviders()
  const pool = activePool(cfg)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const choice = selectProvider(cfg, tried, preferredModel)
    if (!choice) break
    tried.add(choice.id)

    const provider = getProvider(choice.id)
    if (!provider) continue

    const { key } = resolveApiKey(choice.id)
    const started = Date.now()
    const supportsTools = Boolean(useTools && provider.supportsTools)
    const outgoing = messagesFor ? messagesFor(supportsTools) : messages

    try {
      const request = {
        baseUrl: provider.baseUrl,
        apiKey: key,
        model: choice.model,
        messages: outgoing,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
        stream: true,
        tools: supportsTools ? tools : undefined,
        signal,
        anonymous: !key
      }

      let text = ""
      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []
      let finishReason: string | undefined
      let usage: { prompt?: number; completion?: number; total?: number } | undefined

      for await (const chunk of streamChat(request)) {
        if (chunk.text) {
          text += chunk.text
          yield { text: chunk.text, provider: choice.id, model: choice.model }
        }
        if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls)
        if (chunk.finishReason) finishReason = chunk.finishReason
        if (chunk.usage) usage = chunk.usage
      }

      const latency = Date.now() - started
      markSuccess(choice.id, latency)
      attempts.push({ provider: choice.id, model: choice.model, latencyMs: latency })

      // Fall back to the text tool protocol when native tools were unavailable.
      if (!toolCalls.length && useTools && !provider.supportsTools) {
        const parsed = parseTextTool(text)
        if (parsed) {
          log.info(`text-protocol tool call: ${parsed.name}`, JSON.stringify(parsed.arguments).slice(0, 200))
          toolCalls.push(parsed)
        } else if (/```|\btool\b/i.test(text)) {
          log.warn("could not parse a tool call from the model output", text.slice(0, 300))
        }
      }

      yield {
        provider: choice.id,
        model: choice.model,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        finishReason,
        usage
      }
      return
    } catch (err) {
      const latency = Date.now() - started
      const message = err instanceof Error ? err.message : String(err)

      const isLlmError = err instanceof LlmError
      const label = provider.label
      const body = isLlmError ? (err.body ?? "") : ""

      if (isLlmError && isRateLimit(err.status, body) && !rateLimitRetried) {
        // The shared free pool asks you to wait. If there is another source
        // to rotate to, fail over to it now; if not, waiting beats failing.
        const alternatives = pool.filter((id) => id !== choice.id && !tried.has(id))
        if (alternatives.length === 0) {
          // The shared pool allows one reply every 30 seconds. Wait it out —
          // failing would be worse than a short pause.
          const wait = Math.min(retryAfterMs(body) ?? 30_000, 33_000)
          rateLimitRetried = true
          const notice = `The shared free pool allows one reply every 30 seconds — waiting ${Math.round(wait / 1000)}s…`
          log.info(`${choice.id} is rate limited — ${notice}`)
          yield { notice }
          await new Promise((r) => setTimeout(r, wait))
          tried.delete(choice.id)
          continue
        }
      }

      if (isLlmError) {
        const friendly = friendlyProviderError(err.status, body, label)
        lastError = friendly
        // 401/403 = wrong or missing key: quarantine longer than a transient 5xx.
        const cooldown =
          err.status === 401 || err.status === 403
            ? 10 * 60_000
            : err.retryable
              ? (cfg.cooldownMs ?? 45_000)
              : 15_000
        markFailure(choice.id, friendly, cooldown)
        log.warn(`provider ${choice.id} failed: ${friendly}`)
      } else {
        lastError = message
        markFailure(choice.id, message, cfg.cooldownMs ?? 45_000)
        log.warn(`provider ${choice.id} failed: ${message}`)
      }

      if (!isLlmError || !err.retryable) break
      if (tried.size >= maxAttempts) break
    }
  }

  throw new Error(lastError)
}

/* ─────────────────────────  Testing  ───────────────────────── */

export async function testProvider(
  providerId: string,
  model?: string
): Promise<{ ok: boolean; providerId: string; model?: string; latencyMs?: number; reply?: string; error?: string }> {
  const provider = getProvider(providerId)
  if (!provider) {
    return { ok: false, providerId, error: "Unknown provider" }
  }
  if (!isProviderConfigured(providerId)) {
    return { ok: false, providerId, error: providerReason(providerId) ?? "Not configured" }
  }

  const { key } = resolveApiKey(providerId)
  const chosen = model || defaultModelFor(providerId)
  if (!chosen) {
    return {
      ok: false,
      providerId,
      error:
        provider.kind === "local"
          ? `${provider.label} has no model installed.`
          : `${provider.label} does not publish a model list.`
    }
  }
  const started = Date.now()

  try {
    let reply = ""
    for await (const chunk of streamChat({
      baseUrl: provider.baseUrl,
      apiKey: key,
      model: chosen,
      messages: [{ role: "user", content: "Reply with the single word: online" }],
      temperature: 0,
      maxTokens: 16,
      stream: false,
      anonymous: !key
    })) {
      if (chunk.text) reply += chunk.text
    }
    const latency = Date.now() - started
    markSuccess(providerId, latency)
    return { ok: true, providerId, model: chosen, latencyMs: latency, reply: reply.trim().slice(0, 120) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    markFailure(providerId, message, 60_000)
    return { ok: false, providerId, model: chosen, latencyMs: Date.now() - started, error: message }
  }
}

export function resetRotationHealth(): void {
  health.clear()
  rotationCursor = 0
}
