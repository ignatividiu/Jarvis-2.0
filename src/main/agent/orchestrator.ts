import { app } from "electron"
import type { ChatChunk, ChatHistoryEntry, ChatMessage, ToolCall, ToolSpec } from "@shared/types"
import { config } from "../store"
import { createLogger } from "../logger"
import { runRotated } from "../providers/rotation"
import { stripToolBlock } from "../providers/llm"
import { fetchPage, searchWeb } from "../tools/websearch"
import { localStatus, pullModel } from "../tools/local"
import { opencodeWebSearch, runAgent } from "../tools/opencode"
import { speak } from "../voice"

const log = createLogger("orchestrator")

/* ──────────────────────────  Tool definitions  ────────────────────────── */

/**
 * The capability groups, in priority order.
 *
 * Voice comes first: talking to the assistant is its primary purpose, so
 * the speaking tools are offered before the general chat tools, and the
 * coding agent is the last resort.
 */
export const TOOL_GROUPS = {
  voice: ["speak", "set_delivery"],
  chat: ["web_search", "fetch_url", "calculate", "system_info"],
  code: ["code_task", "list_local_models", "install_local_model"]
} as const

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "speak",
    description:
      "Speak a reply out loud. Use it when the user asks to be told something, to have a message read out, " +
      "or to repeat a short answer in a particular way. Plain replies are spoken automatically, so use this " +
      "only when the wording or the delivery matters.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Exactly what should be said." },
        style: { type: "string", description: "An optional delivery style, e.g. 'calm', 'formal' or 'excited'." }
      },
      required: ["text"]
    }
  },
  {
    name: "set_delivery",
    description:
      "Change how the assistant sounds from now on — for example 'speak more formally' or 'be more concise'.",
    parameters: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "A short description of the new delivery." }
      },
      required: ["instruction"]
    }
  },
  {
    name: "web_search",
    description:
      "Search the internet for current information. Use it for anything that may have changed, for facts you are unsure about, or when the user asks to look something up.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." }
      },
      required: ["query"]
    }
  },
  {
    name: "fetch_url",
    description: "Read the full text of a web page. Use it after web_search to read a promising result.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL." }
      },
      required: ["url"]
    }
  },
  {
    name: "code_task",
    description:
      "Delegate a programming task to the OpenCode coding agent. It can read and write files, run commands and search the codebase. Describe the task fully, including the file paths involved.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "A complete description of the coding task." },
        directory: { type: "string", description: "Absolute working directory. Defaults to the configured one." }
      },
      required: ["task"]
    }
  },
  {
    name: "list_local_models",
    description: "List the AI models installed on this machine and available to download.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "install_local_model",
    description: "Download a model so it can be run locally and privately on this machine.",
    parameters: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Model tag, for example qwen3:8b." }
      },
      required: ["tag"]
    }
  },
  {
    name: "system_info",
    description: "Report the current date, time, operating system and machine details.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "calculate",
    description: "Evaluate an arithmetic expression exactly. Use it instead of doing mental maths.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "An arithmetic expression, e.g. (12 * 8) / 3" }
      },
      required: ["expression"]
    }
  }
]

const TOOL_PROTOCOL_INSTRUCTIONS = `

TOOL USE
You can call tools. When you need a tool, reply with EXACTLY one fenced block and nothing else:

\`\`\`tool
{"tool": "web_search", "arguments": {"query": "the search terms"}}
\`\`\`

Available tools, in priority order:
${TOOL_GROUPS.voice.map((n) => `- ${n} (voice)`).join(", ")}
${TOOL_GROUPS.chat.map((n) => `- ${n} (chat)`).join(", ")}
${TOOL_GROUPS.code.map((n) => `- ${n} (code)`).join(", ")}

Rules:
- Emit the tool block INSTEAD of answering when a tool is needed.
- Call exactly ONE tool per reply, then wait for its result.
- Prefer a voice tool over a chat tool, and a chat tool over a code tool.
- Never use web_search for arithmetic or for anything you can reason out — use calculate.
- Never use calculate for facts — use web_search.
- Never invent tool output. After a tool result is provided to you, use it.
- If no tool is needed, answer normally with plain text.
`

const SYSTEM_BASE = `You are {NAME}, a desktop AI assistant running entirely on the user's machine.

{INSTRUCTIONS}

Guidelines:
- Be concise and direct. Short paragraphs, no filler, no restating the question.
- Use British English spelling.
- Prefer a tool call over guessing when the answer depends on live or external information.
- When you use a tool, briefly note what you are doing before the tool block.
- Format with Markdown: short paragraphs, bullet lists for options, fenced code blocks for code.
`

/* ──────────────────────────  Tool execution  ────────────────────────── */

interface ToolOutcome {
  ok: boolean
  summary: string
  /** Text handed back to the model. */
  content: string
  /** A generated speech clip for the renderer to play. */
  clipId?: string
}

function safeEvaluate(expression: string): number | null {
  const cleaned = expression.replace(/[^0-9+\-*/().%\s]/g, "")
  if (!cleaned.trim()) return null
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict";return (${cleaned})`) as () => unknown
    const value = fn()
    return typeof value === "number" && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Resolve a tool call to the tool it actually means.
 *
 * Providers that support native tool calling still receive our text protocol
 * in the system prompt, so a model may emit a native call whose *arguments*
 * contain the real call — for example a native `web_search` whose arguments
 * are `{"tool": "calculate", "arguments": {...}}`. The nested form is the
 * authoritative one, so it wins.
 */
export function resolveToolCall(call: ToolCall): ToolCall {
  const args = (call.arguments ?? {}) as Record<string, unknown>

  const nestedName =
    typeof args.tool === "string" ? args.tool : typeof args.name === "string" ? args.name : null
  const nestedArgs = args.arguments ?? args.args ?? args.input

  if (nestedName && nestedArgs && typeof nestedArgs === "object" && !Array.isArray(nestedArgs)) {
    return { id: call.id, name: nestedName, arguments: nestedArgs as Record<string, unknown> }
  }

  return call
}

async function executeTool(
  call: ToolCall,
  context: { directory?: string }
): Promise<ToolOutcome> {
  const args = call.arguments ?? {}

  switch (call.name) {
    case "speak": {
      const text = String(args.text ?? "").trim()
      if (!text) return { ok: false, summary: "no text", content: "Error: missing text." }
      const style = typeof args.style === "string" ? args.style : undefined

      // A style given here applies to the reply as well.
      if (style) {
        const current = config.get()
        config.update({ voice: { ...current.voice, style } })
      }

      const spoken = await speak({ text, style })
      if (!spoken.ok || !spoken.clipId) {
        return { ok: false, summary: "speech failed", content: `The speech engine failed: ${spoken.error}` }
      }
      return {
        ok: true,
        summary: "spoken",
        content: "The message was spoken aloud.",
        clipId: spoken.clipId
      }
    }

    case "set_delivery": {
      const instruction = String(args.instruction ?? "").trim()
      if (!instruction) {
        return { ok: false, summary: "no instruction", content: "Error: missing instruction." }
      }
      const current = config.get()
      config.update({ voice: { ...current.voice, instruct: instruction } })
      return { ok: true, summary: "delivery changed", content: `The delivery is now: ${instruction}` }
    }

    case "web_search": {
      const query = String(args.query ?? "").trim()
      if (!query) return { ok: false, summary: "web_search needs a query", content: "Error: missing query." }
      const res = await searchWeb(query)
      if (!res.ok) {
        return { ok: false, summary: "search failed", content: `Search failed: ${res.error}` }
      }
      const text = res.results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join("\n\n")
      const summary = `${res.results.length} result(s) from ${res.engine}`
      return { ok: true, summary, content: text || "No results." }
    }

    case "fetch_url": {
      const url = String(args.url ?? "").trim()
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, summary: "bad url", content: "Error: provide an absolute http(s) URL." }
      }
      const text = await fetchPage(url)
      return { ok: true, summary: `read ${url}`, content: text }
    }

    case "code_task": {
      const task = String(args.task ?? "").trim()
      if (!task) return { ok: false, summary: "no task", content: "Error: missing task." }
      let deltas = ""
      const result = await runAgent(
        task,
        (d) => {
          deltas += d
        },
        typeof args.directory === "string" ? args.directory : context.directory
      )
      if (!result.ok) {
        return { ok: false, summary: "agent failed", content: `Coding agent error: ${result.error}` }
      }
      return { ok: true, summary: "code task complete", content: result.output ?? deltas }
    }

    case "list_local_models": {
      const status = await localStatus()
      if (!status.available) {
        return {
          ok: false,
          summary: "no local runtime",
          content: "No local model runtime is running. Install Ollama from the Local Models tab."
        }
      }
      const installed = status.models.filter((m) => m.installed)
      const available = status.models.filter((m) => !m.installed)
      const lines = [
        `Backend: ${status.backend}${status.version ? ` (${status.version})` : ""}`,
        installed.length ? `Installed:\n${installed.map((m) => `- ${m.name}`).join("\n")}` : "Installed: none",
        available.length ? `Available to download:\n${available.map((m) => `- ${m.name}`).join("\n")}` : ""
      ]
      return { ok: true, summary: `${installed.length} installed`, content: lines.filter(Boolean).join("\n\n") }
    }

    case "install_local_model": {
      const tag = String(args.tag ?? "").trim()
      if (!tag) return { ok: false, summary: "no tag", content: "Error: missing model tag." }
      const status = await pullModel(tag)
      if (!status.available) {
        return { ok: false, summary: "no local runtime", content: "The local runtime is not running." }
      }
      return { ok: true, summary: `downloaded ${tag}`, content: `${tag} is installed locally.` }
    }

    case "system_info": {
      const info = {
        name: app.getName(),
        version: app.getVersion(),
        platform: `${process.platform} ${process.arch}`,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        cwd: context.directory ?? process.cwd(),
        time: new Date().toString()
      }
      return { ok: true, summary: "system info", content: JSON.stringify(info, null, 2) }
    }

    case "calculate": {
      const expression = String(args.expression ?? "").trim()
      const value = safeEvaluate(expression)
      if (value === null) {
        return { ok: false, summary: "bad expression", content: `Could not evaluate: ${expression}` }
      }
      return { ok: true, summary: "calculated", content: `${expression} = ${value}` }
    }

    default:
      return {
        ok: false,
        summary: "unknown tool",
        content:
          `Unknown tool "${call.name}". Valid tools are: ${TOOL_SPECS.map((t) => t.name).join(", ")}. ` +
          `Call one of those instead.`
      }
  }
}

/* ──────────────────────────  System prompt  ────────────────────────── */

function buildSystemPrompt(supportsTools: boolean): string {
  const persona = config.get().persona
  const base = SYSTEM_BASE.replace("{NAME}", persona.name).replace("{INSTRUCTIONS}", persona.instructions)
  if (!supportsTools) return base + TOOL_PROTOCOL_INSTRUCTIONS
  return base
}

/**
 * Reshape the conversation for providers that cannot accept `role: "tool"`.
 */
function reshape(messages: ChatMessage[], supportsTools: boolean): ChatMessage[] {
  if (supportsTools) return messages
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: `[Tool result — ${m.name ?? "tool"}]\n${m.content}`
      }
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const { toolCalls, ...rest } = m
      const summary = toolCalls.map((t) => `${t.name}(${JSON.stringify(t.arguments ?? {}).slice(0, 160)})`).join(", ")
      return { ...rest, content: rest.content || `(called ${summary})` }
    }
    return m
  })
}

/* ──────────────────────────  Main loop  ────────────────────────── */

export interface RunOptions {
  text: string
  history?: ChatHistoryEntry[]
  tools?: string[]
  directory?: string
  signal?: AbortSignal
  emit: (chunk: ChatChunk) => void
}

export async function runAssistant(options: RunOptions): Promise<void> {
  const cfg = config.get()
  const started = Date.now()

  const enabledTools = new Set(
    (options.tools ?? TOOL_SPECS.map((t) => t.name)).filter((t) =>
      TOOL_SPECS.some((spec) => spec.name === t)
    )
  )

  // Voice first, then chat, then code — the order the tools are offered in
  // is the order the assistant prefers them.
  const priority = [...TOOL_GROUPS.voice, ...TOOL_GROUPS.chat, ...TOOL_GROUPS.code]
  const byName = new Map(TOOL_SPECS.map((t) => [t.name, t]))
  const activeSpecs: ToolSpec[] = []
  for (const name of priority) {
    if (!enabledTools.has(name)) continue
    const spec = byName.get(name)
    if (spec) activeSpecs.push(spec)
  }
  for (const spec of TOOL_SPECS) {
    if (enabledTools.has(spec.name) && !priority.includes(spec.name as never)) {
      activeSpecs.push(spec)
    }
  }
  const useTools = cfg.agent.toolsEnabled && activeSpecs.length > 0

  /* Conversation history (system message is rebuilt per provider). */
  const history: ChatMessage[] = []
  for (const m of options.history ?? []) {
    if (m.role === "user" || m.role === "assistant") {
      if (m.content.trim()) history.push({ role: m.role, content: m.content })
    }
  }
  history.push({ role: "user", content: options.text })

  const messagesFor = (supportsTools: boolean): ChatMessage[] => {
    const system = buildSystemPrompt(supportsTools)
    const body = reshape(history, supportsTools)
    return [{ role: "system", content: system }, ...body]
  }

  let iteration = 0
  const maxIterations = Math.max(1, Math.min(cfg.agent.maxToolIterations || 6, 12))

  while (iteration < maxIterations) {
    iteration++

    let text = ""
    let provider = ""
    let model = ""
    let toolCalls: ToolCall[] = []

    try {
      for await (const chunk of runRotated(history, {
        cfg: cfg.rotation,
        signal: options.signal,
        tools: activeSpecs,
        useTools,
        messagesFor
      })) {
        if (chunk.notice) {
          options.emit({ type: "notice", notice: chunk.notice })
          continue
        }
        if (chunk.text) {
          text += chunk.text
          provider = chunk.provider ?? provider
          model = chunk.model ?? model
          options.emit({ type: "delta", text: chunk.text, provider, model })
        }
        if (chunk.provider) provider = chunk.provider
        if (chunk.model) model = chunk.model
        if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      options.emit({ type: "error", error: message, provider, model })
      return
    }

    if (!toolCalls.length) {
      // The text-protocol fallback may have embedded the call in the prose.
      const cleaned = stripToolBlock(text)
      options.emit({
        type: "end",
        text: cleaned || text,
        provider,
        model,
        durationMs: Date.now() - started
      })
      return
    }

    // Record the assistant turn.
    const assistantTextClean = stripToolBlock(text)
    history.push({
      role: "assistant",
      content: assistantTextClean || "(used a tool)",
      toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }))
    })

    for (const rawCall of toolCalls) {
      const call = resolveToolCall(rawCall)
      options.emit({ type: "tool", toolCall: call, provider, model })
      let outcome: ToolOutcome
      try {
        outcome = await executeTool(call, { directory: options.directory })
      } catch (err) {
        outcome = {
          ok: false,
          summary: "tool error",
          content: `Tool failed: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      options.emit({
        type: "tool-result",
        toolResult: { name: call.name, ok: outcome.ok, summary: outcome.summary },
        provider,
        model
      })

      // A voice tool produced audio — hand it to the renderer to play.
      if (outcome.clipId) {
        options.emit({ type: "speak", clipId: outcome.clipId, provider, model })
      }

      history.push({
        role: "tool",
        content: outcome.content,
        toolCallId: call.id,
        name: call.name
      })
    }
  }

  options.emit({
    type: "end",
    text: "I reached the tool-iteration limit before finishing. Here is what I have so far.",
    durationMs: Date.now() - started
  })
}

/* ──────────────────────────  Code routing  ────────────────────────── */

const CODE_HINTS = [
  /\b(code|function|class|bug|error|stack trace|refactor|implement|compile|typescript|javascript|python|rust|golang|regex|api endpoint|unit test)\b/i,
  /\b(write|fix|debug|build|create)\b.*\b(script|code|program|function|test|module|component)\b/i,
  /```/
]

export function looksLikeCodeTask(text: string): boolean {
  return CODE_HINTS.some((re) => re.test(text))
}

/** Run a task purely through the OpenCode coding agent. */
export async function runCodeAgent(
  text: string,
  directory: string | undefined,
  emit: (chunk: ChatChunk) => void
): Promise<void> {
  const started = Date.now()
  emit({ type: "start" })
  const result = await runAgent(
    text,
    (delta) => emit({ type: "delta", text: delta, provider: "opencode" }),
    directory
  )
  if (!result.ok) {
    emit({ type: "error", error: result.error ?? "The coding agent failed." })
    return
  }
  emit({ type: "end", text: result.output ?? "", provider: "opencode", durationMs: Date.now() - started })
}

log.debug("orchestrator ready")
