import type { ChatMessage, ToolCall, ToolSpec } from "@shared/types"
import { createLogger } from "../logger"

const log = createLogger("llm")

export interface LlmRequest {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  temperature: number
  maxTokens: number
  stream: boolean
  tools?: ToolSpec[]
  signal?: AbortSignal
  extraHeaders?: Record<string, string>
  /** Skip the Authorization header (keyless endpoints that reject it). */
  anonymous?: boolean
  /** Hard cap on the whole request, in milliseconds. */
  timeoutMs?: number
}

export interface LlmToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface LlmChunk {
  /** Incremental text. */
  text?: string
  /** A complete (non-streamed) tool call. */
  toolCalls?: LlmToolCall[]
  /** Raw finish reason. */
  finishReason?: string
  /** Usage, when the provider reports it. */
  usage?: { prompt?: number; completion?: number; total?: number }
}

export class LlmError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
    public body?: string
  ) {
    super(message)
    this.name = "LlmError"
  }
}

/**
 * Turn a provider error body into a message the user can act on.
 *
 * The shared free pools rate-limit hard, and the raw upstream wording is
 * rarely obvious to the person reading it.
 */
export function friendlyProviderError(status: number, body: string, providerLabel: string): string {
  const text = (body ?? "").toLowerCase()

  const isPoolLimit =
    text.includes("free_limit") ||
    text.includes("free limit reached") ||
    text.includes("usage_missing") ||
    text.includes("invalid or omitted terminal usage") ||
    text.includes("rate limit") ||
    text.includes("too many requests")

  if (isPoolLimit) {
    const wait = /retry after (\d+)/i.exec(body ?? "")?.[1]
    return (
      `${providerLabel} is on its shared free pool, which allows one reply every 30 seconds` +
      (wait ? ` (retry in ${wait}s)` : "") +
      ". Add a free key — Google AI Studio, Groq or OpenRouter — and JARVIS will rotate straight to it."
    )
  }
  if (status === 429) {
    return `${providerLabel} is rate limiting right now. JARVIS will try the next free source; adding a second key removes the wait entirely.`
  }
  if (status === 401 || status === 403) {
    return `${providerLabel} rejected the API key. Check it in Settings → Model providers.`
  }
  if (status === 402) {
    return `${providerLabel} requires a key or a positive balance for this request. Add a free key in Settings → Model providers.`
  }
  if (status === 404) {
    return (
      `${providerLabel} does not have that model. ` +
      (providerLabel.includes("Ollama")
        ? "Open the Local models tab and download one, then refresh the model list."
        : "Refresh the model list in Settings → Model providers.")
    )
  }
  if (status >= 500) {
    return `${providerLabel} is having problems (HTTP ${status}). JARVIS will try the next free source.`
  }
  return `${providerLabel} failed: HTTP ${status}${body ? ` — ${body.slice(0, 160)}` : ""}`
}

/** How long the provider asked us to wait, in milliseconds. */
export function retryAfterMs(body: string): number | undefined {
  const seconds = /retry after (\d+)/i.exec(body ?? "")?.[1]
  if (seconds) return Number(seconds) * 1000
  const iso = /retry-after["':\s]+(\d+)/i.exec(body ?? "")?.[1]
  if (iso) return Number(iso) * 1000
  return undefined
}

/** Is this a rate limit rather than a genuine failure? */
export function isRateLimit(status: number, body: string): boolean {
  const text = (body ?? "").toLowerCase()
  return (
    status === 402 ||
    status === 429 ||
    text.includes("free_limit") ||
    text.includes("free limit reached") ||
    text.includes("usage_missing") ||
    text.includes("invalid or omitted terminal usage") ||
    text.includes("rate limit")
  )
}

function buildHeaders(req: LlmRequest): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(req.extraHeaders ?? {})
  }
  if (!req.anonymous && req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`
  return headers
}

function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      return typeof parsed === "object" && parsed ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** Stream a chat completion, yielding incremental text and tool calls. */
export async function* streamChat(req: LlmRequest): AsyncGenerator<LlmChunk> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => {
      const message: Record<string, unknown> = { role: m.role, content: m.content }
      if (m.role === "tool" && m.toolCallId) message.tool_call_id = m.toolCallId
      if (m.role === "assistant" && m.toolCalls?.length) {
        message.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) }
        }))
      }
      return message
    }),
    temperature: req.temperature,
    max_tokens: req.maxTokens,
    stream: req.stream
  }
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }))
    body.tool_choice = "auto"
  }

  // A provider that stops responding must not stall the assistant: cap the
  // whole request, and honour the caller's cancellation signal as well.
  const timeout = AbortSignal.timeout(req.timeoutMs ?? 120_000)
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout

  const res = await fetch(`${req.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(req),
    body: JSON.stringify(body),
    signal
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    const retryable =
      res.status === 402 || res.status === 408 || res.status === 429 || res.status >= 500
    throw new LlmError(
      `${res.status} ${res.statusText} from ${req.baseUrl}`,
      res.status,
      retryable,
      text
    )
  }

  if (!req.stream) {
    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: unknown[] }
        finish_reason?: string
      }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const choice = data.choices?.[0]
    const toolCalls: LlmToolCall[] = []
    for (const raw of choice?.message?.tool_calls ?? []) {
      const call = raw as { id?: string; function?: { name?: string; arguments?: unknown } }
      if (!call.function?.name) continue
      toolCalls.push({
        id: call.id ?? `call_${toolCalls.length}`,
        name: call.function.name,
        arguments: parseToolArgs(call.function.arguments)
      })
    }
    yield {
      text: choice?.message?.content ?? "",
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: choice?.finish_reason,
      usage: data.usage
        ? {
            prompt: data.usage.prompt_tokens,
            completion: data.usage.completion_tokens,
            total: data.usage.total_tokens
          }
        : undefined
    }
    return
  }

  /* ── SSE parsing ── */
  const reader = res.body?.getReader()
  if (!reader) throw new LlmError("no response body", 0, false)

  const decoder = new TextDecoder()
  let buffer = ""
  let emitted = 0
  // Tool calls arrive in fragments: index → { id, name, args }
  const pending = new Map<number, { id: string; name: string; args: string }>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, sep).trim()
      buffer = buffer.slice(sep + 1)
      if (!line || !line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === "[DONE]") continue

      let parsed: {
        choices?: Array<{
          delta?: {
            content?: string | null
            tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
          }
          finish_reason?: string | null
        }>
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        error?: { message?: string }
      }
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }

      if (parsed.error) {
        const message = parsed.error.message ?? "provider error"
        // Some free providers append an error to a stream that already
        // carried a complete answer (typically a missing usage block). If
        // content has already arrived, take what we have rather than
        // discarding a good answer.
        if (emitted > 0) {
          yield { finishReason: "provider_warning", text: undefined }
          return
        }
        throw new LlmError(message, 0, false, payload)
      }

      const choice = parsed.choices?.[0]
      const delta = choice?.delta
      if (delta?.content) {
        emitted += delta.content.length
        yield { text: delta.content }
      }

      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0
        const entry = pending.get(index) ?? { id: "", name: "", args: "" }
        if (call.id) entry.id = call.id
        if (call.function?.name) entry.name += call.function.name
        if (call.function?.arguments) entry.args += call.function.arguments
        pending.set(index, entry)
      }

      if (choice?.finish_reason) {
        yield { finishReason: choice.finish_reason }
      }
      if (parsed.usage) {
        yield {
          usage: {
            prompt: parsed.usage.prompt_tokens,
            completion: parsed.usage.completion_tokens,
            total: parsed.usage.total_tokens
          }
        }
      }
    }
  }

  if (pending.size) {
    const toolCalls: LlmToolCall[] = []
    for (const entry of pending.values()) {
      if (!entry.name) continue
      toolCalls.push({ id: entry.id || `call_${toolCalls.length}`, name: entry.name, arguments: parseToolArgs(entry.args) })
    }
    if (toolCalls.length) yield { toolCalls }
  }
}

/**
 * Some free providers cannot do native tool calling. For those we fall back
 * to a text protocol: the model is told to emit a fenced ```tool block and we
 * parse it back out. This keeps the agent loop working on every free model.
 */
export function parseTextToolCall(text: string): LlmToolCall | null {
  if (!text) return null

  // Collect every fenced block, then take the last one that holds a valid
  // tool object — models often restate the final call.
  const blocks: string[] = []
  const fenceRe = /```(?:tool|json_tool|json)?\s*([\s\S]*?)```/gi
  let fence: RegExpExecArray | null
  while ((fence = fenceRe.exec(text)) !== null) {
    blocks.push(fence[1])
  }
  if (!blocks.length) blocks.push(text)

  for (const block of blocks.reverse()) {
    const call = parseToolObject(block)
    if (call) return call
  }
  return null
}

/** Pull a tool call out of a chunk of text. */
function parseToolObject(chunk: string): LlmToolCall | null {
  const start = chunk.indexOf("{")
  const end = chunk.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  const slice = chunk.slice(start, end + 1)

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(slice) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null

  // Accept the shapes models actually produce.
  let name = typeof parsed.tool === "string" ? parsed.tool : undefined
  if (!name && typeof parsed.name === "string") name = parsed.name
  if (!name && typeof parsed.function === "string") name = parsed.function
  if (!name && parsed.function && typeof parsed.function === "object") {
    const fn = parsed.function as { name?: unknown }
    if (typeof fn.name === "string") name = fn.name
  }
  if (!name) return null

  // "tool" is the placeholder used in the prompt template — never a real tool.
  if (name === "tool" || name === "TOOL") return null

  let args = parsed.arguments ?? parsed.args ?? parsed.input ?? parsed.parameters
  if (args && typeof args === "object" && !Array.isArray(args)) {
    // A native-style call nests the arguments under function.arguments.
    const fn = parsed.function as { arguments?: unknown } | undefined
    if (fn && typeof fn === "object" && fn.arguments) args = fn.arguments
  }
  if (typeof args === "string") {
    try {
      args = JSON.parse(args)
    } catch {
      args = {}
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) args = {}

  return { id: `text_${Date.now()}`, name, arguments: args as Record<string, unknown> }
}

export function stripToolBlock(text: string): string {
  return text.replace(/```(?:tool|json_tool)?\s*[\s\S]*?```/gi, "").trim()
}

export function normaliseToolCalls(raw: unknown): ToolCall[] {
  const list = Array.isArray(raw) ? raw : []
  const out: ToolCall[] = []
  for (const item of list) {
    const call = item as { id?: string; function?: { name?: string; arguments?: unknown }; name?: string; arguments?: unknown }
    const name = call.function?.name ?? call.name
    if (!name) continue
    out.push({
      id: call.id ?? `call_${out.length}`,
      name,
      arguments: parseToolArgs(call.function?.arguments ?? call.arguments)
    })
  }
  return out
}

log.debug("llm module ready")
