import { useState } from "react"
import { useJarvis } from "../../state/store"

const ENGINES = [
  { id: "auto", label: "Automatic", hint: "Try each backend in turn until one answers" },
  { id: "duckduckgo", label: "DuckDuckGo", hint: "Free, no account" },
  { id: "wikipedia", label: "Wikipedia", hint: "Free, no account — encyclopedic results" },
  { id: "tavily", label: "Tavily", hint: "Needs a free API key (TAVILY_API_KEY)" },
  { id: "brave", label: "Brave", hint: "Needs a free API key (BRAVE_API_KEY)" },
  { id: "searxng", label: "SearXNG", hint: "Your own instance — enter the URL below" },
  { id: "opencode", label: "OpenCode", hint: "Uses the coding agent's own search" }
]

export function SearchTab(): React.ReactElement | null {
  const settings = useJarvis((s) => s.settings)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const toast = useJarvis((s) => s.toast)

  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Array<{ title: string; url: string; snippet: string; source: string }>>([])

  if (!settings) return null

  const run = async (): Promise<void> => {
    const value = query.trim()
    if (!value) return
    setBusy(true)
    try {
      const res = await window.jarvis.websearch.search(value, settings.web.engine)
      if (res.ok) {
        setResults(res.results)
        toast(`${res.results.length} result(s) from ${res.engine}.`, "success")
      } else {
        setResults([])
        toast(res.error ?? "The search failed.", "error")
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h4>Web search</h4>
      <p className="sub">
        The assistant uses this to look things up. DuckDuckGo and Wikipedia need no account at all, so search
        works out of the box.
      </p>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="search-engine">Backend</label>
          <select
            id="search-engine"
            value={settings.web.engine}
            onChange={(e) =>
              void updateSettings({ web: { ...settings.web, engine: e.target.value as typeof settings.web.engine } })
            }
          >
            {ENGINES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <span className="hint">{ENGINES.find((e) => e.id === settings.web.engine)?.hint}</span>
        </div>

        <div className="field">
          <label htmlFor="searxng">SearXNG instance</label>
          <input
            id="searxng"
            type="text"
            value={settings.web.searxngUrl}
            placeholder="https://search.example.com"
            onChange={(e) => void updateSettings({ web: { ...settings.web, searxngUrl: e.target.value } })}
          />
          <span className="hint">Only used when the SearXNG backend is selected.</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="max-results">Results — {settings.web.maxResults}</label>
        <input
          id="max-results"
          type="range"
          min={1}
          max={12}
          step={1}
          value={settings.web.maxResults}
          onChange={(e) =>
            void updateSettings({ web: { ...settings.web, maxResults: Number(e.target.value) } })
          }
        />
      </div>

      <h4>Try it</h4>
      <div className="row" style={{ gap: 8 }}>
        <input
          type="text"
          placeholder="Search the web…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn sm primary" onClick={() => void run()} disabled={busy}>
          <span className="material-symbols-outlined">search</span>
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {results.length > 0 && (
        <div className="provider-models" style={{ marginTop: 12, flexDirection: "column", gap: 8 }}>
          {results.map((r, i) => (
            <div key={i} style={{ width: "100%" }}>
              <a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.preventDefault()}>
                {r.title}
              </a>
              <div className="tiny muted ellipsis">{r.url}</div>
              {r.snippet && <div className="tiny">{r.snippet}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
