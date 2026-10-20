import { useJarvis } from "../state/store"

export function TopBar(): React.ReactElement {
  const state = useJarvis((s) => s.state)
  const voice = useJarvis((s) => s.voice)
  const providers = useJarvis((s) => s.providers)
  const openSettings = useJarvis((s) => s.openSettings)
  const toggleVisualizer = useJarvis((s) => s.toggleVisualizer)

  const ready = providers.filter((p) => p.configured).length

  return (
    <header className="top-bar">
      <div className="top-title">
        <h2>JARVIS</h2>
        <span>
          {ready} free source{ready === 1 ? "" : "s"} ready
          {providers.length > 0 && ` · ${providers.length} in the pool`}
        </span>
      </div>

      <div className="spacer" />

      {state !== "idle" && (
        <span className="chip live">
          <span className="dot" />
          {state === "listening" ? "Listening" : state === "thinking" ? "Thinking" : "Speaking"}
        </span>
      )}

      <span className={`chip ${voice?.activeEngine === "browser" ? "warn" : "live"}`} title="Voice engine">
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>graphic_eq</span>
        {voice?.activeVoiceName ?? "Voice"}
      </span>

      <button type="button" className="btn sm" onClick={() => openSettings("providers")}>
        <span className="material-symbols-outlined">hub</span>
        Providers
      </button>

      <button type="button" className="btn sm ghost" onClick={toggleVisualizer} title="Expand the visualiser">
        <span className="material-symbols-outlined">blur_circular</span>
      </button>
    </header>
  )
}
