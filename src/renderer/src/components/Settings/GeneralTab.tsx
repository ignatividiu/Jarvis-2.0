import { useJarvis } from "../../state/store"

export function GeneralTab(): React.ReactElement | null {
  const settings = useJarvis((s) => s.settings)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const opencode = useJarvis((s) => s.opencode)
  const local = useJarvis((s) => s.local)
  const toast = useJarvis((s) => s.toast)

  if (!settings) return null

  const setUi = (patch: Partial<typeof settings.ui>): void => {
    void updateSettings({ ui: { ...settings.ui, ...patch } })
  }

  const setPersona = (patch: Partial<typeof settings.persona>): void => {
    void updateSettings({ persona: { ...settings.persona, ...patch } })
  }

  const setAgent = (patch: Partial<typeof settings.agent>): void => {
    void updateSettings({ agent: { ...settings.agent, ...patch } })
  }

  return (
    <>
      <h4>Persona</h4>
      <div className="field">
        <label htmlFor="persona-name">Name</label>
        <input
          id="persona-name"
          type="text"
          value={settings.persona.name}
          onChange={(e) => setPersona({ name: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="persona-instructions">Instructions</label>
        <textarea
          id="persona-instructions"
          rows={4}
          value={settings.persona.instructions}
          onChange={(e) => setPersona({ instructions: e.target.value })}
        />
        <span className="hint">How the assistant should behave and speak.</span>
      </div>

      <div className="field">
        <label htmlFor="voice-mode">Voice mode</label>
        <select
          id="voice-mode"
          value={settings.voice.alwaysOn ? "on" : "off"}
          onChange={(e) => void updateSettings({ voice: { ...settings.voice, alwaysOn: e.target.value === "on" } })}
        >
          <option value="off">Off - the transcript is typed into the composer for review</option>
          <option value="on">On - each transcript is sent the moment you stop speaking</option>
        </select>
        <div className="hint">Also toggled from the *Always on* button in the voice dock.</div>
      </div>

      <div className="field">
        <label htmlFor="speak">Spoken replies</label>
        <select
          id="speak"
          value={settings.persona.speak ? "on" : "off"}
          onChange={(e) => setPersona({ speak: e.target.value === "on" })}
        >
          <option value="on">On - JARVIS reads its replies aloud</option>
          <option value="off">Off - the replies are only shown</option>
        </select>
      </div>

      <h4 style={{ marginTop: 22 }}>Coding agent</h4>
      <div className="field">
        <label htmlFor="code-dir">Working directory</label>
        <input
          id="code-dir"
          type="text"
          value={settings.opencode.directory}
          placeholder="C:\\projects\\my-app"
          onChange={(e) => void updateSettings({ opencode: { ...settings.opencode, directory: e.target.value } })}
        />
        <span className="hint">Where the OpenCode agent works. Leave it empty to use the current folder.</span>
      </div>

      <div className="field">
        <label htmlFor="code-port">OpenCode port — {settings.opencode.port}</label>
        <input
          id="code-port"
          type="number"
          min={1024}
          max={65535}
          value={settings.opencode.port}
          onChange={(e) =>
            void updateSettings({ opencode: { ...settings.opencode, port: Number(e.target.value) || 4096 } })
          }
        />
        <span className="hint">
          {opencode?.running ? "The server is running." : opencode?.available ? "The server is installed but stopped." : "opencode was not found."}
        </span>
      </div>

      <div className="field">
        <label htmlFor="auto-code">Route code questions automatically</label>
        <select
          id="auto-code"
          value={settings.agent.autoRouteCode ? "on" : "off"}
          onChange={(e) => setAgent({ autoRouteCode: e.target.value === "on" })}
        >
          <option value="off">Off - the user picks the mode</option>
          <option value="on">On - code questions go to the coding agent</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="iterations">Tool iterations — {settings.agent.maxToolIterations}</label>
        <input
          id="iterations"
          type="range"
          min={1}
          max={12}
          step={1}
          value={settings.agent.maxToolIterations}
          onChange={(e) => setAgent({ maxToolIterations: Number(e.target.value) })}
        />
        <span className="hint">How many times the assistant may call a tool for one request.</span>
      </div>

      <h4 style={{ marginTop: 22 }}>Local models</h4>
      <div className="field">
        <label htmlFor="local-model">Preferred local model</label>
        <input
          id="local-model"
          type="text"
          value={settings.local.model}
          placeholder="qwen3:4b"
          onChange={(e) => void updateSettings({ local: { ...settings.local, model: e.target.value } })}
        />
        <span className="hint">
          {local?.available
            ? `${local.models.filter((m) => m.installed).length} model(s) installed.`
            : "No local runtime is running."}
        </span>
      </div>

      <h4 style={{ marginTop: 22 }}>Appearance</h4>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="theme">Theme</label>
          <select
            id="theme"
            value={settings.ui.theme}
            onChange={(e) => setUi({ theme: e.target.value as typeof settings.ui.theme })}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">Follow the system</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="accent">Accent colour</label>
          <input
            id="accent"
            type="text"
            value={settings.ui.accent}
            onChange={(e) => setUi({ accent: e.target.value })}
          />
          <span className="hint">A hex colour such as #3ddc97.</span>
        </div>
      </div>

      <h4 style={{ marginTop: 22 }}>Layout</h4>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="chat-side">Chat position</label>
          <select
            id="chat-side"
            value={settings.ui.chatSide}
            onChange={(e) => setUi({ chatSide: e.target.value as typeof settings.ui.chatSide })}
          >
            <option value="left">Left — the visualiser is on the right</option>
            <option value="right">Right — the visualiser is in the middle</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="vis-size">Visualiser size</label>
          <select
            id="vis-size"
            value={settings.ui.visualizerSize}
            onChange={(e) => setUi({ visualizerSize: e.target.value as typeof settings.ui.visualizerSize })}
          >
            <option value="large">Large</option>
            <option value="medium">Medium</option>
            <option value="small">Small</option>
          </select>
          <span className="hint">The visualiser can also be changed from the panel itself.</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="reset">Reset</label>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn sm danger"
            onClick={() => {
              void window.jarvis.settings.reset().then(() => {
                toast("Settings reset to their defaults.", "info")
                void useJarvis.getState().init()
              })
            }}
          >
            <span className="material-symbols-outlined">restart_alt</span>
            Reset every setting
          </button>
        </div>
      </div>
    </>
  )
}
