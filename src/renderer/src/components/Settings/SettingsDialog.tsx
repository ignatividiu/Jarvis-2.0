import { useJarvis } from "../../state/store"
import { ProvidersTab } from "./ProvidersTab"
import { VoiceTab } from "./VoiceTab"
import { AudioTab } from "./AudioTab"
import { LocalTab } from "./LocalTab"
import { SearchTab } from "./SearchTab"
import { GeneralTab } from "./GeneralTab"

const TABS = [
  { id: "providers", label: "Model providers", icon: "hub" },
  { id: "voice", label: "Voice", icon: "record_voice_over" },
  { id: "audio", label: "Microphone & speaker", icon: "settings_input_component" },
  { id: "local", label: "Local models", icon: "memory" },
  { id: "search", label: "Web search", icon: "travel_explore" },
  { id: "general", label: "Preferences", icon: "tune" }
]

export function SettingsDialog(): React.ReactElement | null {
  const open = useJarvis((s) => s.settingsOpen)
  const tab = useJarvis((s) => s.setupTab)
  const close = useJarvis((s) => s.closeSettings)
  const openSettings = useJarvis((s) => s.openSettings)

  if (!open) return null

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="JARVIS settings">
        <div className="dialog-head">
          <span className="material-symbols-outlined" style={{ color: "var(--jarvis-primary)" }}>settings</span>
          <h3>Settings</h3>
          <button type="button" className="btn sm ghost" onClick={close} aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="dialog-body">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tab ${tab === t.id ? "active" : ""}`}
                onClick={() => openSettings(t.id)}
              >
                <span className="material-symbols-outlined">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>

          <div className="tab-pane">
            {tab === "providers" && <ProvidersTab />}
            {tab === "voice" && <VoiceTab />}
            {tab === "audio" && <AudioTab />}
            {tab === "local" && <LocalTab />}
            {tab === "search" && <SearchTab />}
            {tab === "general" && <GeneralTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
