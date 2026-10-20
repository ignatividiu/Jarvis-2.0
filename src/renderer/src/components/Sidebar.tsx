import { useJarvis } from "../state/store"

export function Sidebar(): React.ReactElement {
  const settings = useJarvis((s) => s.settings)
  const providers = useJarvis((s) => s.providers)
  const voice = useJarvis((s) => s.voice)
  const local = useJarvis((s) => s.local)
  const openSettings = useJarvis((s) => s.openSettings)
  const openSetup = useJarvis((s) => s.openSetup)
  const clearConversation = useJarvis((s) => s.clearConversation)
  const toggleSidebar = useJarvis((s) => s.toggleSidebar)

  const ready = providers.filter((p) => p.configured)
  const localModels = local?.models.filter((m) => m.installed) ?? []

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">J</div>
        <div className="brand-text">
          <h1>JARVIS</h1>
          <p>Local-first AI desk</p>
        </div>
      </div>

      <div className="sidebar-section">
        <button type="button" className="side-item" onClick={clearConversation}>
          <span className="material-symbols-outlined">add_comment</span>
          <span className="side-item-text">New conversation</span>
        </button>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">System</div>
        <div className="sidebar-scroll">
          <button type="button" className="side-item" onClick={openSetup}>
            <span className="material-symbols-outlined">rocket_launch</span>
            <span className="side-item-text">Setup wizard</span>
          </button>

          <button type="button" className="side-item" onClick={() => openSettings("providers")}>
            <span className="material-symbols-outlined">hub</span>
            <span className="side-item-text">Model providers</span>
            {ready.length > 0 && <span className="side-badge">{ready.length}</span>}
          </button>

          <button type="button" className="side-item" onClick={() => openSettings("voice")}>
            <span className="material-symbols-outlined">record_voice_over</span>
            <span className="side-item-text">Voice</span>
            <span
              className="side-badge"
              style={{ color: voice?.activeEngine === "browser" ? "var(--jarvis-amber)" : undefined }}
            >
              {voice?.activeEngine === "edge" ? "edge" : voice?.activeEngine === "piper" ? "offline" : "system"}
            </span>
          </button>

          <button type="button" className="side-item" onClick={() => openSettings("audio")}>
            <span className="material-symbols-outlined">settings_input_component</span>
            <span className="side-item-text">Microphone &amp; speaker</span>
          </button>

          <button type="button" className="side-item" onClick={() => openSettings("local")}>
            <span className="material-symbols-outlined">memory</span>
            <span className="side-item-text">Local models</span>
            {localModels.length > 0 && <span className="side-badge">{localModels.length}</span>}
          </button>

          <button type="button" className="side-item" onClick={() => openSettings("search")}>
            <span className="material-symbols-outlined">travel_explore</span>
            <span className="side-item-text">Web search</span>
          </button>

          <button type="button" className="side-item" onClick={() => openSettings("general")}>
            <span className="material-symbols-outlined">tune</span>
            <span className="side-item-text">Preferences</span>
          </button>
        </div>
      </div>

      {ready.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-label">Ready sources</div>
          {ready.map((p) => (
            <div key={p.id} className="side-item" style={{ cursor: "default" }}>
              <i className={`status-dot ${p.healthy === false ? "warn" : "ok"}`} />
              <span className="side-item-text ellipsis">{p.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="sidebar-section" style={{ marginTop: "auto" }}>
        <button type="button" className="side-item" onClick={toggleSidebar}>
          <span className="material-symbols-outlined">left_panel_close</span>
          <span className="side-item-text">Collapse</span>
        </button>
        {settings && (
          <div className="tiny muted" style={{ padding: "4px 10px" }}>
            {settings.persona.name} · v2.0
          </div>
        )}
      </div>
    </nav>
  )
}
