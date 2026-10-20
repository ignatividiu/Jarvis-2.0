import type { SearchResponse, SearchResult } from "@shared/types"
import { config } from "../store"
import { createLogger } from "../logger"
import { fetchJson, fetchText } from "../net"
import { opencodeWebSearch } from "./opencode"

const log = createLogger("websearch")

/**
 * Web search.
 *
 * Several free backends are supported, in order of quality. DuckDuckGo and
 * Wikipedia need no account at all, which means the assistant can look
 * things up before the user has configured anything.
 */

interface Backend {
  id: string
  label: string
  search: (query: string) => Promise<SearchResult[]>
}

/** Pull the readable text out of a page. */
export async function fetchPage(url: string): Promise<string> {
  const html = await fetchText(url, {
    timeoutMs: 20_000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS/2.0)" }
  })

  // Strip the parts of a page that are never worth reading.
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return body.slice(0, 12_000)
}

/** DuckDuckGo's HTML endpoint — no key required. */
async function duckduckgo(query: string): Promise<SearchResult[]> {
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    timeoutMs: 20_000,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  })

  const results: SearchResult[] = []
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi

  let match: RegExpExecArray | null
  while ((match = linkRe.exec(html)) !== null && results.length < 12) {
    const url = decodeDdgUrl(match[1])
    const title = stripTags(match[2])
    if (!url || !title) continue
    results.push({ title, url, snippet: "", source: "duckduckgo" })
  }
  return results
}

/** DuckDuckGo wraps the target in a redirect — the real URL is in the query. */
function decodeDdgUrl(href: string): string {
  const raw = href.replace(/^.*uddg=/, "").split("&")[0]
  try {
    return decodeURIComponent(raw)
  } catch {
    return ""
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** The Wikipedia search API — no key required. */
async function wikipedia(query: string): Promise<SearchResult[]> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=8" +
    `&srsearch=${encodeURIComponent(query)}&origin=*`

  const data = await fetchJson<{
    query?: { search?: Array<{ title: string; snippet: string; pageid: number }> }
  }>(url, { timeoutMs: 15_000 })

  return (data.query?.search ?? []).map((r) => ({
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
    snippet: stripTags(r.snippet),
    source: "wikipedia"
  }))
}

/** Tavily — a free tier with a key. */
async function tavily(query: string, apiKey: string): Promise<SearchResult[]> {
  const data = await fetchJson<{
    results?: Array<{ title?: string; url?: string; content?: string }>
  }>("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { api_key: apiKey, query, max_results: 8 },
    timeoutMs: 20_000
  })

  return (data.results ?? []).map((r) => ({
    title: r.title ?? r.url ?? "Untitled",
    url: r.url ?? "",
    snippet: (r.content ?? "").replace(/\s+/g, " ").trim(),
    source: "tavily"
  }))
}

/** Brave Search — a free tier with a key. */
async function brave(query: string, apiKey: string): Promise<SearchResult[]> {
  const data = await fetchJson<{
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  }>(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    timeoutMs: 20_000
  })

  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? r.url ?? "Untitled",
    url: r.url ?? "",
    snippet: (r.description ?? "").replace(/\s+/g, " ").trim(),
    source: "brave"
  }))
}

/** A SearXNG instance — usually self-hosted, so the URL is configured. */
async function searxng(query: string, instance: string): Promise<SearchResult[]> {
  const base = instance.replace(/\/$/, "")
  const data = await fetchJson<{
    results?: Array<{ title?: string; url?: string; content?: string; engine?: string }>
  }>(`${base}/search?q=${encodeURIComponent(query)}&format=json`, {
    headers: { Accept: "application/json" },
    timeoutMs: 20_000
  })

  return (data.results ?? []).map((r) => ({
    title: r.title ?? r.url ?? "Untitled",
    url: r.url ?? "",
    snippet: (r.content ?? "").replace(/\s+/g, " ").trim(),
    source: r.engine ?? "searxng"
  }))
}

/** The backends, in the order they are tried. */
function backends(settings: ReturnType<typeof config.get>): Backend[] {
  const list: Backend[] = [
    { id: "duckduckgo", label: "DuckDuckGo", search: duckduckgo },
    { id: "wikipedia", label: "Wikipedia", search: wikipedia }
  ]

  const tavilyKey = process.env.TAVILY_API_KEY
  if (tavilyKey) list.push({ id: "tavily", label: "Tavily", search: (q) => tavily(q, tavilyKey) })

  const braveKey = process.env.BRAVE_API_KEY
  if (braveKey) list.push({ id: "brave", label: "Brave", search: (q) => brave(q, braveKey) })

  if (settings.web.searxngUrl) {
    const instance = settings.web.searxngUrl
    list.push({ id: "searxng", label: "SearXNG", search: (q) => searxng(q, instance) })
  }

  list.push({
    id: "opencode",
    label: "OpenCode",
    search: async (q) => (await opencodeWebSearch(q)).map((r) => ({ ...r, source: "opencode" }))
  })

  return list
}

/**
 * Search the web.
 *
 * The configured engine is tried first; the others are used as a fallback so
 * a single broken backend never leaves the assistant without answers.
 */
export async function searchWeb(query: string, engine?: string): Promise<SearchResponse> {
  const clean = (query ?? "").trim()
  if (!clean) return { ok: false, query: clean, results: [], error: "No search term was given." }

  const settings = config.get()
  const wanted = (engine ?? settings.web.engine ?? "auto").toLowerCase()
  const all = backends(settings)

  const ordered = wanted === "auto" ? all : [...all.filter((b) => b.id === wanted), ...all]

  let lastError = "No search backend answered."

  for (const backend of ordered) {
    try {
      const results = await backend.search(clean)
      if (results.length) {
        return {
          ok: true,
          query: clean,
          results: results.slice(0, settings.web.maxResults || 6),
          engine: backend.label
        }
      }
      lastError = `${backend.label} returned no results.`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`${backend.id} search failed: ${message}`)
      lastError = `${backend.label} failed: ${message}`
    }
  }

  return { ok: false, query: clean, results: [], error: lastError }
}
