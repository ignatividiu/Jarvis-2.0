import { useEffect, useState } from "react"
import type { SetupProgress } from "@shared/types"
import { useJarvis } from "../state/store"

type Step = "welcome" | "providers" | "local" | "voice" | "done"

const STEPS: Step[] = ["welcome", "providers", "local", "voice", "done"]

const STEP_LABELS: Record<Step, string> = {
  welcome: "Welcome",
  providers: "Models",
  local: "Local",
  voice: "Voice",
  done: "Done"
}

export function SetupWizard(): React.ReactElement | null {
  const open = useJarvis((s) => s.setupOpen)
  const closeSetup = useJarvis((s) => s.closeSetup)
  const providers = useJarvis((s) => s.providers)
  const refreshProviders = useJarvis((s) => s.refreshProviders)
  const refreshVoice = useJarvis((s) => s.refreshVoice)
  const refreshLocal = useJarvis((s) => s.refreshLocal)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const settings = useJarvis((s) => s.settings)
  const toast = useJarvis((s) => s.toast)

  const [step, setStep] = useState<Step>("welcome")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<SetupProgress | null>(null)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [installLocal, setInstallLocal] = useState(true)
  const [installVoice, setInstallVoice] = useState(true)
  const [installSpeech, setInstallSpeech] = useState(true)
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    const off = window.jarvis.events.on("setup:progress", (payload) => {
      setProgress(payload as SetupProgress)
    })
    void refreshProviders()
    void refreshVoice()
    void refreshLocal()
    return off
  }, [open, refreshProviders, refreshVoice, refreshLocal])

  if (!open) return null

  const index = STEPS.indexOf(step)
  const go = (next: Step): void => setStep(next)

  const saveKey = async (providerId: string): Promise<void> => {
    const value = (keys[providerId] ?? "").trim()
    if (!value) return
    await window.jarvis.settings.setApiKey(providerId, value)
    setKeys((k) => ({ ...k, [providerId]: "" }))
    await refreshProviders()
  }

  const runSetup = async (): Promise<void> => {
    setBusy(true)
    setLog([])
    try {
      const res = await window.jarvis.setup.run({
        ollama: installLocal,
        models: installLocal,
        voice: installVoice,
        speech: installSpeech
      })
      setLog(res.log)

      await Promise.all([refreshProviders(), refreshVoice(), refreshLocal()])
      go("done")
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const ready = providers.filter((p) => p.configured)
  const keyless = providers.filter((p) => p.keyless)
  const needKey = providers.filter((p) => !p.configured && !p.keyless).slice(0, 4)

  return (
    <div className="scrim">
      <div className="wizard">
        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <div
              key={s}
              style={{ display: "flex", alignItems: "center", gap: 8, flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}
            >
              <div className={`wizard-step ${s === step ? "active" : ""} ${i < index ? "done" : ""}`}>
                <i>{i < index ? "OK" : i + 1}</i>
                <span className="nowrap">{STEP_LABELS[s]}</span>
              </div>
              {i < STEPS.length - 1 && <div className="wizard-line" />}
            </div>
          ))}
        </div>

        {step === "welcome" && (
          <>
            <h3 style={{ margin: "0 0 6px", fontSize: 19 }}>Welcome aboard.</h3>
            <p className="muted" style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.6 }}>
              JARVIS is a desktop assistant that runs on free models, keeps your voice local, searches the web and
              writes code through OpenCode. This wizard wires up the pieces. You can change everything later.
            </p>

            <div className="option-card selected">
              <span className="material-symbols-outlined">bolt</span>
              <div>
                <div className="t">Zero-config start</div>
                <div className="d">
                  Pollinations works with no account at all, so you can talk to JARVIS immediately. Add a free API key
                  for a bigger, more reliable pool of models.
                </div>
              </div>
            </div>

            <div className="option-card" onClick={() => go("providers")}>
              <span className="material-symbols-outlined">key</span>
              <div>
                <div className="t">Connect free API keys</div>
                <div className="d">
                  Google, Groq, OpenRouter, Cerebras, Mistral, Cohere, SambaNova and more. Each free tier is
                  independent, so the more you add the more requests JARVIS can make.
                </div>
              </div>
            </div>

            <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
              <button type="button" className="btn primary" onClick={() => go("providers")}>
                Continue
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            </div>
          </>
        )}

        {step === "providers" && (
          <>
            <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>Model sources</h3>
            <p className="muted" style={{ margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.6 }}>
              {ready.length > 0
                ? `${ready.length} source${ready.length === 1 ? "" : "s"} ready: ${ready.map((p) => p.label).join(", ")}.`
                : "You already have a keyless source ready, so JARVIS works right now. Add more keys for reliability and a wider model pool."}
            </p>

            {keyless.length > 0 && (
              <div className="banner good">
                <span className="material-symbols-outlined">check_circle</span>
                <div>{keyless.map((p) => p.label).join(", ")} - no account needed, already active.</div>
              </div>
            )}

            <h4 style={{ fontSize: 13, margin: "4px 0 10px" }}>Add a free key (optional)</h4>
            {needKey.map((p) => (
              <div key={p.id} className="provider-card off">
                <div className="provider-top">
                  <span className="name">{p.label}</span>
                  {p.requiresCard && <span className="chip warn">card</span>}
                </div>
                <p className="provider-notes">{p.notes}</p>
                <div className="row" style={{ gap: 6, marginTop: 9 }}>
                  <input
                    type="password"
                    placeholder="Paste your free API key"
                    value={keys[p.id] ?? ""}
                    onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => void saveKey(p.id)}
                    disabled={!(keys[p.id] ?? "").trim()}
                  >
                    Save
                  </button>
                  {p.signupUrl && (
                    <button type="button" className="btn sm" onClick={() => void window.jarvis.app.openExternal(p.signupUrl!)}>
                      Get key
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
              <button type="button" className="btn ghost" onClick={() => go("welcome")}>
                Back
              </button>
              <button type="button" className="btn primary" onClick={() => go("local")}>
                Continue
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            </div>
          </>
        )}

        {step === "local" && (
          <>
            <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>Local models</h3>
            <p className="muted" style={{ margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.6 }}>
              Install Ollama and a small model so JARVIS can work completely offline, with no limits and no data
              leaving this machine. The runtime is unpacked into the app's own folder - no administrator rights
              required.
            </p>

            <div className={`option-card ${installLocal ? "selected" : ""}`} onClick={() => setInstallLocal((v) => !v)}>
              <span className="material-symbols-outlined">download</span>
              <div>
                <div className="t">Download Ollama and a recommended model</div>
                <div className="d">
                  Roughly 1.2 GB for the runtime plus about 2.6 GB for a 4B model. Everything else is optional.
                </div>
              </div>
            </div>

            <div className="banner info">
              <span className="material-symbols-outlined">info</span>
              <div>
                Already have Ollama, LM Studio or a llama.cpp server running? JARVIS detects them automatically and
                uses them instead.
              </div>
            </div>

            <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
              <button type="button" className="btn ghost" onClick={() => go("providers")}>
                Back
              </button>
              <button type="button" className="btn primary" onClick={() => go("voice")}>
                Continue
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            </div>
          </>
        )}

        {step === "voice" && (
          <>
            <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>Voice</h3>
            <p className="muted" style={{ margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.6 }}>
              JARVIS speaks with Microsoft's free Edge read-aloud voices - no account, no key, and the British
              voices are superb. Speech recognition runs on a local Whisper model, so nothing you say ever leaves
              this machine.
            </p>

            <div className={`option-card ${installSpeech ? "selected" : ""}`} onClick={() => setInstallSpeech((v) => !v)}>
              <span className="material-symbols-outlined">graphic_eq</span>
              <div>
                <div className="t">Download the local speech model</div>
                <div className="d">
                  Whisper Tiny is about 42 MB and recognises a short phrase in roughly 150 ms - fast enough to
                  react to the wake word in real time.
                </div>
              </div>
            </div>

            <div className={`option-card ${installVoice ? "selected" : ""}`} onClick={() => setInstallVoice((v) => !v)}>
              <span className="material-symbols-outlined">cloud_off</span>
              <div>
                <div className="t">Install the offline voice engine</div>
                <div className="d">
                  Piper is a small, completely offline speech engine. With it JARVIS can still talk when there is
                  no internet connection. About 85 MB including a British voice.
                </div>
              </div>
            </div>

            <div className="banner info">
              <span className="material-symbols-outlined">info</span>
              <div>
                The online engine is already configured and needs no download at all - it is only useful to have
                the offline one as a backstop.
              </div>
            </div>

            {progress && (
              <div className="field" style={{ marginTop: 14 }}>
                <div className="row spread" style={{ marginBottom: 6 }}>
                  <span className="tiny">{progress.message}</span>
                  <span className="tiny mono">{progress.percent}%</span>
                </div>
                <div className="progress">
                  <i style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            )}

            <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
              <button type="button" className="btn ghost" onClick={() => go("local")}>
                Back
              </button>
              <button type="button" className="btn primary" onClick={() => void runSetup()} disabled={busy}>
                {busy ? "Setting up…" : "Finish setup"}
                <span className="material-symbols-outlined">rocket_launch</span>
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h3 style={{ margin: "0 0 6px", fontSize: 19 }}>All systems nominal.</h3>
            <p className="muted" style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.6 }}>
              {ready.length} model source{ready.length === 1 ? "" : "s"} ready. Use the microphone to talk, or type a
              question. Everything is editable in Settings.
            </p>

            {log.length > 0 && (
              <div
                className="provider-card"
                style={{ maxHeight: 220, overflowY: "auto", fontFamily: "var(--jarvis-mono)", fontSize: 11.5 }}
              >
                {log.map((line, i) => (
                  <div key={i} style={{ padding: "2px 0", color: "var(--md-sys-color-on-surface-variant)" }}>
                    {line}
                  </div>
                ))}
              </div>
            )}

            <div className="row" style={{ marginTop: 18, justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void updateSettings({ ui: { ...(settings?.ui ?? {}), visualizer: "orb" } as never })
                }}
              >
                Keep the current HUD
              </button>
              <button type="button" className="btn primary" onClick={closeSetup}>
                Start talking
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
