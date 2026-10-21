import { useJarvis } from "../state/store"
import { Hud } from "./Hud"
import { JarvisVisualizer } from "./Visualizer/JarvisVisualizer"
import { VISUALIZER_MODES, type VisualizerMode } from "./Visualizer/visualizers"

interface Props {
  /** The controls are hidden in the full-screen overlay. */
  compact?: boolean
}

/**
 * The visualiser panel.
 *
 * It sits in the middle of the window, with the chat on either side. The
 * size and the side of the chat are both settings, so the assistant can be
 * laid out the way it suits the screen it is on.
 */
export function VisualizerPanel({ compact = false }: Props): React.ReactElement {
  const settings = useJarvis((s) => s.settings)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const toggleVisualizer = useJarvis((s) => s.toggleVisualizer)

  if (!settings) return <div className="visualizer-column" />

  const mode = (settings.ui.visualizer as VisualizerMode) ?? "orb"

  const setMode = (next: VisualizerMode): void => {
    void updateSettings({ ui: { ...settings.ui, visualizer: next } })
  }

  const setSide = (side: "left" | "right"): void => {
    void updateSettings({ ui: { ...settings.ui, chatSide: side } })
  }

  const setSize = (size: "large" | "medium" | "small"): void => {
    void updateSettings({ ui: { ...settings.ui, visualizerSize: size } })
  }

  return (
    <section className="visualizer-column">
      <div className="visualizer-stage">
        <JarvisVisualizer mode={mode} accent={settings.ui.accent} className="visualizer-canvas" />

        {!compact && (
          <div className="visualizer-tools">
            <div className="tool-group">
              <button
                type="button"
                className={`tool-toggle ${settings.ui.chatSide === "left" ? "on" : ""}`}
                onClick={() => setSide("left")}
                title="Put the chat on the left"
              >
                <span className="material-symbols-outlined">align_horizontal_left</span>
                Chat left
              </button>
              <button
                type="button"
                className={`tool-toggle ${settings.ui.chatSide === "right" ? "on" : ""}`}
                onClick={() => setSide("right")}
                title="Put the chat on the right"
              >
                <span className="material-symbols-outlined">align_horizontal_right</span>
                Chat right
              </button>
            </div>

            <div className="tool-group">
              {(["large", "medium", "small"] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`tool-toggle ${settings.ui.visualizerSize === size ? "on" : ""}`}
                  onClick={() => setSize(size)}
                  title={`${size[0].toUpperCase()}${size.slice(1)} visualiser`}
                >
                  <span className="material-symbols-outlined">
                    {size === "large" ? "fullscreen" : size === "medium" ? "crop_square" : "picture_in_picture"}
                  </span>
                  {size[0].toUpperCase() + size.slice(1)}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="tool-toggle"
              onClick={toggleVisualizer}
              title="Expand the visualiser to fill the window"
            >
              <span className="material-symbols-outlined">open_in_full</span>
              Expand
            </button>
          </div>
        )}
      </div>

      {!compact && (
        <div className="visualizer-modes">
          {VISUALIZER_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`mode-chip ${mode === m.id ? "on" : ""}`}
              onClick={() => setMode(m.id)}
              title={m.label}
            >
              <span className="material-symbols-outlined">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
      )}

      {!compact && <Hud showVisualizer={false} />}
    </section>
  )
}
