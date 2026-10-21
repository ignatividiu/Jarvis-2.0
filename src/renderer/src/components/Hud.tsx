import { useJarvis } from "../state/store"
import { JarvisVisualizer } from "./Visualizer/JarvisVisualizer"
import type { VisualizerMode } from "./Visualizer/visualizers"

export function Hud({ showVisualizer = false }: { showVisualizer?: boolean }): React.ReactElement | null {
  const settings = useJarvis((s) => s.settings)
  const providers = useJarvis((s) => s.providers)
  const voice = useJarvis((s) => s.voice)
  const local = useJarvis((s) => s.local)
  const opencode = useJarvis((s) => s.opencode)
  const state = useJarvis((s) => s.state)
  const streamingProvider = useJarvis((s) => s.streamingProvider)
  const streamingModel = useJarvis((s) => s.streamingModel)
  const toggleVisualizer = useJarvis((s) => s.toggleVisualizer)

  if (!settings) return null

  const ready = providers.filter((p) => p.configured)
  const mode = (settings.ui.visualizer as VisualizerMode) ?? "orb"
  const localModels = local?.models.filter((m) => m.installed) ?? []

  return (
    <aside className="hud">
      {showVisualizer && (
        <div className="hud-visualizer">
          <JarvisVisualizer mode={mode} accent={settings.ui.accent} />

          <button
            type="button"
            className="hud-expand"
            onClick={toggleVisualizer}
            title="Expand the visualiser"
            aria-label="Expand the visualiser"
          >
            <span className="material-symbols-outlined">open_in_full</span>
          </button>

          <div className="hud-overlay">
            <div>
              <div className="hud-state">
                {state === "listening" ? "listening" : state === "thinking" ? "processing" : state === "speaking" ? "speaking" : "standby"}
              </div>
              <div className="hud-readout">
                {streamingModel ?? settings.persona.name.toUpperCase()}
                <br />
                {streamingProvider ?? (ready.length ? `${ready.length} sources` : "no source")}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="hud-body">
        <div className="hud-group">
          <h4>Assistant</h4>
          <div className="hud-row">
            <span className="k">Model sources</span>
            <span className={`v ${ready.length ? "good" : "bad"}`}>{ready.length} ready</span>
          </div>
          <div className="hud-row">
            <span className="k">Strategy</span>
            <span className="v">{settings.rotation.strategy}</span>
          </div>
          <div className="hud-row">
            <span className="k">Max attempts</span>
            <span className="v">{settings.rotation.maxAttempts}</span>
          </div>
          <div className="hud-row">
            <span className="k">Tools</span>
            <span className={`v ${settings.agent.toolsEnabled ? "good" : "warn"}`}>
              {settings.agent.toolsEnabled ? "enabled" : "off"}
            </span>
          </div>
        </div>

        <div className="hud-group">
          <h4>Voice</h4>
          <div className="hud-row">
            <span className="k">Engine</span>
            <span className={`v ${voice?.activeEngine === "browser" ? "warn" : "good"}`}>
              {voice?.activeEngine === "edge"
                ? "Edge (online)"
                : voice?.activeEngine === "piper"
                  ? "Piper (offline)"
                  : "System voice"}
            </span>
          </div>
          <div className="hud-row">
            <span className="k">Recogniser</span>
            <span className={`v ${voice?.activeSttEngine === "whisper" ? "good" : "warn"}`}>
              {voice?.activeSttEngine === "whisper" ? "Local Whisper" : "Browser"}
            </span>
          </div>
          <div className="hud-row">
            <span className="k">Voice</span>
            <span className="v ellipsis" title={voice?.activeVoiceName ?? ""}>
              {voice?.activeVoiceName ?? "-"}
            </span>
          </div>
          <div className="hud-row">
            <span className="k">Always on</span>
            <span className={`v ${settings.voice.alwaysOn ? "good" : "warn"}`}>
              {settings.voice.alwaysOn ? `waiting for "${settings.voice.wakeWord}"` : "off"}
            </span>
          </div>
          <div className="hud-row">
            <span className="k">Offline engine</span>
            <span className={`v ${voice?.piperInstalled ? "good" : "warn"}`}>
              {voice?.piperInstalled ? "installed" : "not installed"}
            </span>
          </div>
          <div className="hud-row">
            <span className="k">Spoken replies</span>
            <span className={`v ${settings.persona.speak ? "good" : "warn"}`}>
              {settings.persona.speak ? "on" : "off"}
            </span>
          </div>
        </div>

        <div className="hud-group">
          <h4>Local runtime</h4>
          <div className="hud-row">
            <span className="k">Backend</span>
            <span className={`v ${local?.available ? "good" : "warn"}`}>{local?.backend ?? "none"}</span>
          </div>
          <div className="hud-row">
            <span className="k">Models</span>
            <span className="v">{localModels.length} installed</span>
          </div>
          {localModels.slice(0, 4).map((m) => (
            <div key={m.name} className="hud-row">
              <span className="k ellipsis">{m.name}</span>
              <span className="v tiny">{m.parameterSize ?? "-"}</span>
            </div>
          ))}
        </div>

        <div className="hud-group">
          <h4>Coding agent</h4>
          <div className="hud-row">
            <span className="k">OpenCode</span>
            <span className={`v ${opencode?.running ? "good" : opencode?.available ? "warn" : "bad"}`}>
              {opencode?.running ? "running" : opencode?.available ? "stopped" : "not found"}
            </span>
          </div>
          {opencode?.version && (
            <div className="hud-row">
              <span className="k">Version</span>
              <span className="v">{opencode.version}</span>
            </div>
          )}
          {opencode?.directory && (
            <div className="hud-row">
              <span className="k">Directory</span>
              <span className="v tiny mono ellipsis" title={opencode.directory}>
                {opencode.directory}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
