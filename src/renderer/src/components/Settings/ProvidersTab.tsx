import { useEffect, useState } from "react"
import type { ProviderStatus, RotationStrategy } from "@shared/types"
import { useJarvis } from "../../state/store"

const STRATEGIES: Array<{ id: RotationStrategy; label: string; hint: string }> = [
  { id: "round-robin", label: "Round robin", hint: "Cycle through every ready source in turn." },
  { id: "priority", label: "Priority", hint: "Always prefer the first source in the list." },
  { id: "latency", label: "Lowest latency", hint: "Pick whichever source has been responding fastest." },
  { id: "quota-aware", label: "Quota aware", hint: "Spread load evenly and back off from rate limits." },
  { id: "random", label: "Random", hint: "Pick a source at random for each request." }
]

export function ProvidersTab(): React.ReactElement {
  const providers = useJarvis((s) => s.providers)
  const settings = useJarvis((s) => s.settings)
  const refreshProviders = useJarvis((s) => s.refreshProviders)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const toast = useJarvis((s) => s.toast)

  const [keys, setKeys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [showKeyless, setShowKeyless] = useState(false)
  const [testingAll, setTestingAll] = useState(false)

  useEffect(() => {
    void refreshProviders()
  }, [refreshProviders])

  if (!settings) return <div className="muted">Loading…</div>

  const ready = providers.filter((p) => p.configured)
  const needsKey = providers.filter((p) => !p.configured && !p.keyless)
  const keyless = providers.filter((p) => p.keyless)

  const saveKey = async (provider: ProviderStatus): Promise<void> => {
    const value = (keys[provider.id] ?? "").trim()
    if (!value) return
    setBusy((b) => ({ ...b, [provider.id]: "key" }))
    try {
      await window.jarvis.settings.setApiKey(provider.id, value)
      setKeys((k) => ({ ...k, [provider.id]: "" }))
      await refreshProviders()
      toast(`${provider.label} key saved and encrypted on this machine.`, "success")
    } finally {
      setBusy((b) => ({ ...b, [provider.id]: "" }))
    }
  }

  const clearKey = async (provider: ProviderStatus): Promise<void> => {
    await window.jarvis.settings.clearApiKey(provider.id)
    await refreshProviders()
    toast(`${provider.label} key removed.`, "info")
  }

  const test = async (provider: ProviderStatus): Promise<void> => {
    setBusy((b) => ({ ...b, [provider.id]: "test" }))
    setTestResults((r) => ({ ...r, [provider.id]: { ok: true, message: "Testing…" } }))
    try {
      const res = await window.jarvis.providers.test(provider.id)
      setTestResults((r) => ({
        ...r,
        [provider.id]: {
          ok: res.ok,
          message: res.ok ? `OK — ${res.model} in ${res.latencyMs}ms` : res.error ?? "Failed"
        }
      }))
      await refreshProviders()
    } finally {
      setBusy((b) => ({ ...b, [provider.id]: "" }))
    }
  }

  const discover = async (provider: ProviderStatus): Promise<void> => {
    setBusy((b) => ({ ...b, [provider.id]: "discover" }))
    try {
      const updated = await window.jarvis.providers.discover(provider.id)
      const found = updated.find((p) => p.id === provider.id)
      toast(
        found && found.models.length
          ? `${provider.label}: ${found.models.length} models available.`
          : `${provider.label}: no models returned.`,
        found && found.models.length ? "success" : "error"
      )
    } finally {
      setBusy((b) => ({ ...b, [provider.id]: "" }))
    }
  }

  /** Probe every configured provider at once. */
  const testAll = async (): Promise<void> => {
    setTestingAll(true)
    setTestResults({})
    try {
      const results = await window.jarvis.providers.testAll()
      const next: Record<string, { ok: boolean; message: string }> = {}
      for (const r of results) {
        next[r.providerId] = {
          ok: r.ok,
          message: r.ok ? `OK — ${r.model} in ${r.latencyMs} ms` : r.error ?? "Failed"
        }
      }
      setTestResults(next)
      const good = results.filter((r) => r.ok).length
      toast(
        `${good} of ${results.length} sources answered.`,
        good === results.length ? "success" : good > 0 ? "info" : "error"
      )
      await refreshProviders()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setTestingAll(false)
    }
  }

  const renderProvider = (provider: ProviderStatus): React.ReactElement => (
    <div key={provider.id} className={`provider-card ${provider.configured ? "ready" : "off"}`}>
      <div className="provider-top">
        <i className={`status-dot ${provider.configured ? (provider.healthy === false ? "warn" : "ok") : "idle"}`} />
        <span className="name">{provider.label}</span>
        {provider.keyless && <span className="chip">no key</span>}
        {provider.requiresCard && <span className="chip warn">card required</span>}
        {provider.kind === "local" && <span className="chip">local</span>}
        {provider.rpm ? <span className="chip">{provider.rpm}/min</span> : null}
        {provider.liveModels && <span className="chip good">live models</span>}
      </div>

      {provider.notes && <p className="provider-notes">{provider.notes}</p>}

      {/* The model this provider should use. */}
      {provider.models.length > 0 && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <label className="tiny muted nowrap" htmlFor={`model-${provider.id}`}>
            Model
          </label>
          <select
            id={`model-${provider.id}`}
            value={settings.rotation.modelPreference[provider.id] ?? ""}
            onChange={(e) =>
              void updateSettings({
                rotation: {
                  ...settings.rotation,
                  modelPreference: {
                    ...settings.rotation.modelPreference,
                    [provider.id]: e.target.value
                  }
                }
              })
            }
            style={{ flex: 1, minWidth: 0 }}
          >
            <option value="">Automatic — the first one the provider offers</option>
            {provider.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.id}
                {m.context ? ` · ${Math.round(m.context / 1000)}k` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {provider.models.length > 0 && (
        <div className="provider-models">
          {provider.models.slice(0, 6).map((m) => (
            <span key={m.id} className={`model-tag ${m.free ? "free" : ""}`} title={m.id}>
              {m.name ?? m.id}
            </span>
          ))}
          {provider.models.length > 6 && <span className="model-tag">+{provider.models.length - 6} more</span>}
        </div>
      )}

      {provider.configured && (
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          <button type="button" className="btn sm" onClick={() => void test(provider)} disabled={busy[provider.id] === "test"}>
            <span className="material-symbols-outlined">network_check</span>
            {busy[provider.id] === "test" ? "Testing…" : "Test"}
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => void discover(provider)}
            disabled={busy[provider.id] === "discover"}
          >
            <span className="material-symbols-outlined">refresh</span>
            {busy[provider.id] === "discover" ? "Listing…" : "Refresh models"}
          </button>
          {provider.kind !== "local" && (
            <button type="button" className="btn sm danger" onClick={() => void clearKey(provider)}>
              <span className="material-symbols-outlined">key_off</span>
              Remove key
            </button>
          )}
        </div>
      )}

      {testResults[provider.id] && (
        <p className="provider-notes" style={{ color: testResults[provider.id].ok ? "var(--jarvis-primary)" : "var(--jarvis-danger)" }}>
          {testResults[provider.id].message}
        </p>
      )}

      {!provider.configured && provider.kind !== "local" && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="password"
              placeholder="Paste your free API key"
              value={keys[provider.id] ?? ""}
              onChange={(e) => setKeys((k) => ({ ...k, [provider.id]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && void saveKey(provider)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn sm primary"
              onClick={() => void saveKey(provider)}
              disabled={busy[provider.id] === "key" || !(keys[provider.id] ?? "").trim()}
            >
              Save
            </button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 7 }}>
            {provider.signupUrl && (
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => void window.jarvis.app.openExternal(provider.signupUrl!)}
              >
                <span className="material-symbols-outlined">open_in_new</span>
                Get a free key
              </button>
            )}
            {provider.envKeys.length > 0 && (
              <span className="tiny muted">or export {provider.envKeys.join(" / ")}</span>
            )}
          </div>
        </div>
      )}

      {!provider.configured && provider.reason && (
        <p className="provider-notes" style={{ color: "var(--jarvis-amber)" }}>{provider.reason}</p>
      )}

      {provider.lastError && <p className="provider-notes" style={{ color: "var(--jarvis-danger)" }}>{provider.lastError}</p>}
    </div>
  )

  return (
    <>
      <h4>Free models, in rotation</h4>
      <p className="sub">
        Every source below has a free tier. JARVIS spreads requests across the ones you enable, and automatically
        fails over to the next when a provider rate-limits, errors or runs out of quota. Keys are encrypted with your
        operating system's keychain and never leave this machine.
      </p>

      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <button type="button" className="btn sm" onClick={() => void testAll()} disabled={testingAll}>
          <span className="material-symbols-outlined">network_check</span>
          {testingAll ? "Testing every source…" : "Test every source"}
        </button>
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => {
            setTestResults({})
            void refreshProviders()
          }}
        >
          <span className="material-symbols-outlined">refresh</span>
          Refresh
        </button>
      </div>

      {ready.length > 0 && (
        <>
          <h4>Ready ({ready.length})</h4>
          {ready.map(renderProvider)}
        </>
      )}

      {needsKey.length > 0 && (
        <>
          <h4>Needs a key ({needsKey.length})</h4>
          {needsKey.map(renderProvider)}
        </>
      )}

      {keyless.length > 0 && (
        <>
          <h4>
            Keyless{" "}
            <button
              type="button"
              className="btn sm ghost"
              style={{ marginLeft: 6 }}
              onClick={() => setShowKeyless((v) => !v)}
            >
              {showKeyless ? "Hide" : "Show"}
            </button>
          </h4>
          {showKeyless && keyless.map(renderProvider)}
        </>
      )}

      <h4 style={{ marginTop: 22 }}>Rotation</h4>
      <p className="sub">How JARVIS picks a model for each request.</p>

      <div className="field">
        <label htmlFor="strategy">Strategy</label>
        <select
          id="strategy"
          value={settings.rotation.strategy}
          onChange={(e) =>
            void updateSettings({ rotation: { ...settings.rotation, strategy: e.target.value as RotationStrategy } })
          }
        >
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="hint">{STRATEGIES.find((s) => s.id === settings.rotation.strategy)?.hint}</span>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="attempts">Maximum attempts</label>
          <input
            id="attempts"
            type="number"
            min={1}
            max={10}
            value={settings.rotation.maxAttempts}
            onChange={(e) =>
              void updateSettings({
                rotation: { ...settings.rotation, maxAttempts: Math.max(1, Math.min(10, Number(e.target.value))) }
              })
            }
          />
          <span className="hint">How many sources may be tried for one request.</span>
        </div>

        <div className="field">
          <label htmlFor="temperature">Temperature — {settings.rotation.temperature.toFixed(2)}</label>
          <input
            id="temperature"
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={settings.rotation.temperature}
            onChange={(e) =>
              void updateSettings({ rotation: { ...settings.rotation, temperature: Number(e.target.value) } })
            }
          />
          <span className="hint">Lower is more focused, higher is more creative.</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="tokens">Maximum tokens — {settings.rotation.maxTokens}</label>
        <input
          id="tokens"
          type="range"
          min={256}
          max={8192}
          step={256}
          value={settings.rotation.maxTokens}
          onChange={(e) =>
            void updateSettings({ rotation: { ...settings.rotation, maxTokens: Number(e.target.value) } })
          }
        />
      </div>
    </>
  )
}
