import type { CatalogueModel, LocalModel, LocalStatus, SetupProgress } from "@shared/types"
import { createLogger } from "../logger"
import { fetchJson } from "../net"
import { findOllamaBinary, findSystemOllama, isOllamaRunning, ollamaVersion, OLLAMA_BASE } from "../setup/ollama"

const log = createLogger("local")

/**
 * Catalogue of models that can be installed locally.
 * Sizes are approximate download sizes.
 */
export const MODEL_CATALOGUE: CatalogueModel[] = [
  {
    name: "qwen3",
    tag: "qwen3:4b",
    sizeBytes: 2_600_000_000,
    parameterSize: "4B",
    quantization: "Q4_K_M",
    description: "Excellent all-round model with strong tool-calling and multilingual ability.",
    recommended: true
  },
  {
    name: "qwen3",
    tag: "qwen3:8b",
    sizeBytes: 5_200_000_000,
    parameterSize: "8B",
    quantization: "Q4_K_M",
    description: "Sharper reasoning than 4B while still comfortable on a laptop.",
    recommended: true
  },
  {
    name: "qwen3",
    tag: "qwen3:1.7b",
    sizeBytes: 1_400_000_000,
    parameterSize: "1.7B",
    quantization: "Q4_K_M",
    description: "Very light — the fastest option on CPU-only machines.",
    light: true
  },
  {
    name: "llama3.2",
    tag: "llama3.2:3b",
    sizeBytes: 2_000_000_000,
    parameterSize: "3B",
    quantization: "Q4_K_M",
    description: "Meta's efficient small model. Fast, reliable, good instruction following.",
    light: true
  },
  {
    name: "gemma3",
    tag: "gemma3:4b",
    sizeBytes: 3_300_000_000,
    parameterSize: "4B",
    quantization: "Q4_K_M",
    description: "Google's open model — strong reasoning for its size.",
    recommended: true
  },
  {
    name: "phi4",
    tag: "phi4:14b",
    sizeBytes: 9_000_000_000,
    parameterSize: "14B",
    quantization: "Q4_K_M",
    description: "Microsoft's reasoning model. Needs roughly 12GB of RAM.",
    light: false
  },
  {
    name: "deepseek-r1",
    tag: "deepseek-r1:7b",
    sizeBytes: 4_700_000_000,
    parameterSize: "7B",
    quantization: "Q4_K_M",
    description: "Distilled reasoning model. Great for step-by-step answers.",
    light: false
  },
  {
    name: "mistral-small",
    tag: "mistral-small:24b",
    sizeBytes: 15_000_000_000,
    parameterSize: "24B",
    quantization: "Q4_K_M",
    description: "High quality European model. Wants 16GB+ of RAM.",
    light: false
  },
  {
    name: "qwen2.5-coder",
    tag: "qwen2.5-coder:7b",
    sizeBytes: 4_700_000_000,
    parameterSize: "7B",
    quantization: "Q4_K_M",
    description: "Code-specialised model — the local workhorse for programming tasks.",
    light: false
  },
  {
    name: "llama3.1",
    tag: "llama3.1:8b",
    sizeBytes: 4_900_000_000,
    parameterSize: "8B",
    quantization: "Q4_K_M",
    description: "Battle-tested 8B general model.",
    light: false
  }
]

interface OllamaTag {
  name: string
  size?: number
  modified_at?: string
  details?: { parameter_size?: string; quantization_level?: string; family?: string }
}

interface OllamaPullChunk {
  status?: string
  digest?: string
  total?: number
  completed?: number
  error?: string
}

/** Detect which local backend is available. */
async function detectBackend(): Promise<{
  backend: LocalStatus["backend"]
  baseUrl: string
  available: boolean
  installed: boolean
  version?: string
  error?: string
}> {
  // Ollama first.
  const ollamaUp = await isOllamaRunning()
  const ollamaInstalled = Boolean(findOllamaBinary() ?? findSystemOllama())
  if (ollamaUp || ollamaInstalled) {
    return {
      backend: "ollama",
      baseUrl: `${OLLAMA_BASE}/v1`,
      available: ollamaUp,
      installed: ollamaInstalled,
      version: ollamaUp ? await ollamaVersion() : undefined,
      error: ollamaUp
        ? undefined
        : "The Ollama runtime is installed but not running — press Start to start it."
    }
  }

  // LM Studio.
  try {
    const res = await fetchJson<{ data?: unknown[] }>("http://127.0.0.1:1234/v1/models", { timeoutMs: 1200 })
    if (res?.data) {
      return {
        backend: "lmstudio",
        baseUrl: "http://127.0.0.1:1234/v1",
        available: true,
        installed: true
      }
    }
  } catch {
    /* not running */
  }

  // llama.cpp server.
  try {
    const res = await fetchJson<{ data?: unknown[] }>("http://127.0.0.1:8080/v1/models", { timeoutMs: 1200 })
    if (res?.data) {
      return {
        backend: "llamacpp",
        baseUrl: "http://127.0.0.1:8080/v1",
        available: true,
        installed: true
      }
    }
  } catch {
    /* not running */
  }

  return {
    backend: "none",
    baseUrl: `${OLLAMA_BASE}/v1`,
    available: false,
    installed: false,
    error: "No local runtime detected. Install Ollama to run models on this machine."
  }
}

let busy = false
let progress = 0

export async function localStatus(): Promise<LocalStatus> {
  const detected = await detectBackend()
  let models: LocalModel[] = []

  if (detected.available && detected.backend === "ollama") {
    try {
      const data = await fetchJson<{ models?: OllamaTag[] }>(`${OLLAMA_BASE}/api/tags`, { timeoutMs: 8000 })
      const installedNames = new Set((data.models ?? []).map((m) => m.name))
      models = (data.models ?? []).map((m) => ({
        name: m.name,
        sizeBytes: m.size ?? 0,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
        family: m.details?.family,
        modifiedAt: m.modified_at,
        installed: true,
        available: true
      }))
      for (const entry of MODEL_CATALOGUE) {
        if (!installedNames.has(entry.tag) && !installedNames.has(`${entry.name}:latest`)) {
          models.push({
            name: entry.tag,
            sizeBytes: entry.sizeBytes,
            parameterSize: entry.parameterSize,
            quantization: entry.quantization,
            installed: false,
            available: true,
            description: entry.description
          })
        }
      }
    } catch (err) {
      log.warn("could not list ollama models", String(err))
    }
  } else if (detected.available) {
    try {
      const data = await fetchJson<{ data?: Array<{ id: string }> }>(`${detected.baseUrl}/models`, { timeoutMs: 5000 })
      models = (data.data ?? []).map((m) => ({
        name: m.id,
        sizeBytes: 0,
        installed: true,
        available: true
      }))
    } catch {
      /* ignore */
    }
  }

  return {
    available: detected.available,
    installed: detected.installed,
    version: detected.version,
    baseUrl: detected.baseUrl,
    models,
    error: detected.error,
    busy,
    progress,
    backend: detected.backend,
    catalogue: MODEL_CATALOGUE
  }
}

/**
 * Download a model into the local runtime, streaming progress.
 */
export async function pullModel(tag: string, onProgress?: (p: SetupProgress) => void): Promise<LocalStatus> {
  const detected = await detectBackend()
  if (detected.backend !== "ollama" || !detected.available) {
    return localStatus()
  }

  busy = true
  progress = 0
  onProgress?.({
    stage: "pulling",
    component: "models",
    percent: 0,
    message: `Downloading ${tag}…`
  })

  try {
    const controller = new AbortController()
    const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tag, stream: true }),
      signal: controller.signal
    })

    if (!res.ok || !res.body) {
      throw new Error(`pull failed: ${res.status} ${res.statusText}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        let chunk: OllamaPullChunk
        try {
          chunk = JSON.parse(line) as OllamaPullChunk
        } catch {
          continue
        }
        if (chunk.error) throw new Error(chunk.error)

        if (chunk.total && chunk.completed !== undefined) {
          const pct = Math.min(99, Math.round((chunk.completed / chunk.total) * 100))
          progress = pct
          onProgress?.({
            stage: "pulling",
            component: "models",
            percent: pct,
            message: `Downloading ${tag} — ${pct}%`,
            bytes: { total: chunk.total, received: chunk.completed }
          })
        } else if (chunk.status) {
          onProgress?.({
            stage: "pulling",
            component: "models",
            percent: progress,
            message: chunk.status
          })
        }
      }
    }

    progress = 100
    onProgress?.({ stage: "done", component: "models", percent: 100, message: `${tag} is ready` })
    return localStatus()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("pull failed", message)
    onProgress?.({ stage: "error", component: "models", percent: 0, message: "Model download failed", error: message })
    return localStatus()
  } finally {
    busy = false
  }
}

/** Remove a locally installed model. */
export async function removeModel(tag: string): Promise<LocalStatus> {
  try {
    await fetch(`${OLLAMA_BASE}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tag })
    })
  } catch (err) {
    log.warn("delete failed", String(err))
  }
  return localStatus()
}
