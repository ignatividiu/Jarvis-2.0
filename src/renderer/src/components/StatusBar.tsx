import { useJarvis } from "../state/store"

export function StatusBar(): React.ReactElement {
  const providers = useJarvis((s) => s.providers)
  const voice = useJarvis((s) => s.voice)
  const local = useJarvis((s) => s.local)
  const opencode = useJarvis((s) => s.opencode)

  const ready = providers.filter((p) => p.configured).length

  return (
    <footer className="status-bar">
      <span>
        <i className={`status-dot ${ready ? "ok" : "bad"}`} />
        {ready} model source{ready === 1 ? "" : "s"}
      </span>
      <span className="sep" />
      <span>
        <i className={`status-dot ${voice?.activeEngine === "browser" ? "warn" : "ok"}`} />
        {voice?.activeEngine === "edge"
          ? "Voice: Edge"
          : voice?.activeEngine === "piper"
            ? "Voice: offline"
            : "Voice: system"}
      </span>
      <span className="sep" />
      <span>
        <i className={`status-dot ${local?.available ? "ok" : "idle"}`} />
        {local?.available ? `Local: ${local.backend}` : "Local: off"}
      </span>
      <span className="sep" />
      <span>
        <i className={`status-dot ${opencode?.running ? "ok" : "idle"}`} />
        Code agent {opencode?.running ? "ready" : "idle"}
      </span>
      <div className="spacer" />
      <span>JARVIS · free models in rotation</span>
    </footer>
  )
}
