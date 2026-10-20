import { useEffect, useState } from "react"
import { useJarvis } from "../../state/store"

export function LocalTab(): React.ReactElement | null {
  const local = useJarvis((s) => s.local)
  const settings = useJarvis((s) => s.settings)
  const refreshLocal = useJarvis((s) => s.refreshLocal)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const toast = useJarvis((s) => s.toast)

  const [busy, setBusy] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    void refreshLocal()
  }, [refreshLocal])

  if (!local || !settings) return null

  const installed = local.models.filter((m) => m.installed)
  const available = local.models.filter((m) => !m.installed)

  const install = async (): Promise<void> => {
    setInstalling(true)
    try {
      const result = await window.jarvis.local.install()
      toast(result.message, result.ok ? "success" : "error")
      await refreshLocal()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setInstalling(false)
    }
  }

  const pull = async (tag: string): Promise<void> => {
    setBusy(tag)
    try {
      await window.jarvis.local.pull(tag)
      await refreshLocal()
      toast(`${tag} is installed.`, "success")
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(null)
    }
  }

  const remove = async (tag: string): Promise<void> => {
    setBusy(tag)
    try {
      await window.jarvis.local.remove(tag)
      await refreshLocal()
      toast(`${tag} was removed.`, "info")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <h4>Local runtime</h4>
      <p className="sub">
        A model running on this machine is the most reliable source there is: no rate limits, no account, and
        nothing you say leaves the computer. Ollama is downloaded into the app's own folder, so no administrator
        rights are needed.
      </p>

      <div className="row spread" style={{ marginBottom: 12 }}>
        <span>
          Backend: <b>{local.backend}</b>
          {local.version ? ` (${local.version})` : ""}
        </span>
        {local.installed ? (
          <button type="button" className="btn sm" onClick={() => void refreshLocal()}>
            <span className="material-symbols-outlined">refresh</span>
            Refresh
          </button>
        ) : (
          <button type="button" className="btn sm primary" onClick={() => void install()} disabled={installing}>
            <span className="material-symbols-outlined">download</span>
            {installing ? "Installing…" : "Install the local runtime"}
          </button>
        )}
      </div>

      {local.error && <div className="banner info">{local.error}</div>}

      {installed.length > 0 && (
        <>
          <h4>Installed ({installed.length})</h4>
          {installed.map((m) => (
            <div key={m.name} className="provider-card ready">
              <div className="provider-top">
                <span className="name">{m.name}</span>
                {m.parameterSize && <span className="chip">{m.parameterSize}</span>}
                {m.quantization && <span className="chip">{m.quantization}</span>}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  className={`btn sm ${settings.local.model === m.name ? "primary" : "ghost"}`}
                  onClick={() => void updateSettings({ local: { ...settings.local, model: m.name } })}
                >
                  {settings.local.model === m.name ? "Preferred" : "Make preferred"}
                </button>
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={() => void remove(m.name)}
                  disabled={busy === m.name}
                >
                  <span className="material-symbols-outlined">delete</span>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      <h4>Available to download</h4>
      {available.length === 0 ? (
        <p className="sub">The catalogue is empty. Install the runtime to see the models it can fetch.</p>
      ) : (
        available.map((m) => (
          <div key={m.name} className="provider-card">
            <div className="provider-top">
              <span className="name">{m.name}</span>
              {m.recommended && <span className="chip good">recommended</span>}
              {m.parameterSize && <span className="chip">{m.parameterSize}</span>}
              {m.quantization && <span className="chip">{m.quantization}</span>}
            </div>
            {m.description && <p className="provider-notes">{m.description}</p>}
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <button
                type="button"
                className="btn sm"
                onClick={() => void pull(m.name)}
                disabled={busy === m.name}
              >
                <span className="material-symbols-outlined">download</span>
                {busy === m.name ? "Downloading…" : `Download (${(m.sizeBytes / 1e9).toFixed(1)} GB)`}
              </button>
            </div>
          </div>
        ))
      )}
    </>
  )
}
