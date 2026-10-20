import { useJarvis } from "../state/store"
import { JarvisVisualizer } from "./Visualizer/JarvisVisualizer"

/**
 * The full-screen visualiser.
 *
 * It covers the whole window, so the app can be used as an ambient display
 * while JARVIS talks.
 */
export function VisualizerOverlay(): React.ReactElement | null {
  const expanded = useJarvis((s) => s.visualizerExpanded)
  const settings = useJarvis((s) => s.settings)
  const toggleVisualizer = useJarvis((s) => s.toggleVisualizer)

  if (!expanded || !settings) return null

  return (
    <div className="overlay-canvas">
      <JarvisVisualizer
        mode={(settings.ui.visualizer as "orb") ?? "orb"}
        accent={settings.ui.accent}
        className="overlay-fill"
      />

      <div className="overlay-top">
        <div className="brand-mark">J</div>
        <div className="brand-text">
          <h1>JARVIS</h1>
          <p>{settings.persona.name} · on standby</p>
        </div>
      </div>

      <div className="overlay-bottom">
        <button type="button" className="btn" onClick={toggleVisualizer}>
          <span className="material-symbols-outlined">close_fullscreen</span>
          Back to the console
        </button>
      </div>
    </div>
  )
}
