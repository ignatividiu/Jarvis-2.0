import { useCallback, useEffect, useRef, useState } from "react"
import { Sidebar } from "./components/Sidebar"
import { TopBar } from "./components/TopBar"
import { ChatPanel } from "./components/Chat/ChatPanel"
import { Composer } from "./components/Chat/Composer"
import { Hud } from "./components/Hud"
import { StatusBar } from "./components/StatusBar"
import { SettingsDialog } from "./components/Settings/SettingsDialog"
import { SetupWizard } from "./components/SetupWizard"
import { VisualizerOverlay } from "./components/VisualizerOverlay"
import { VoiceDock } from "./components/VoiceDock"
import { useJarvis } from "./state/store"
import { useChat } from "./hooks/useChat"
import { useSpeaker } from "./hooks/useSpeaker"
import { usePushToTalk } from "./hooks/useVoice"
import { voiceSession } from "./audio/session"
import type { ChatChunk } from "@shared/types"

export function App(): React.ReactElement {
  const ready = useJarvis((s) => s.ready)
  const settings = useJarvis((s) => s.settings)
  const init = useJarvis((s) => s.init)
  const handleChunk = useJarvis((s) => s.handleChunk)
  const sidebarCollapsed = useJarvis((s) => s.sidebarCollapsed)
  const hudCollapsed = useJarvis((s) => s.hudCollapsed)
  const toasts = useJarvis((s) => s.toasts)
  const dismissToast = useJarvis((s) => s.dismissToast)
  const setupOpen = useJarvis((s) => s.setupOpen)
  const { send, cancel, busy } = useChat()
  useSpeaker()

  const [firstRun, setFirstRun] = useState(false)

  // Boot the store and subscribe to main-process events.
  useEffect(() => {
    void init()
    const offChunk = window.jarvis.events.on("chat:chunk", (payload) => {
      handleChunk(payload as ChatChunk)
    })
    const offVoice = window.jarvis.events.on("voice:changed", () => {
      void useJarvis.getState().refreshVoice()
    })
    return () => {
      offChunk()
      offVoice()
    }
  }, [init, handleChunk])

  // Apply the theme.
  useEffect(() => {
    if (!settings) return
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    const theme = settings.ui.theme === "system" ? (prefersDark ? "dark" : "light") : settings.ui.theme
    document.documentElement.setAttribute("data-theme", theme)
    document.documentElement.style.setProperty("--jarvis-primary", settings.ui.accent)
  }, [settings])

  // Offer the setup wizard the first time the app runs.
  useEffect(() => {
    if (!ready) return
    if (window.localStorage.getItem("jarvis2.setup.seen")) return
    window.localStorage.setItem("jarvis2.setup.seen", "1")
    setFirstRun(true)
  }, [ready])

  const openSetup = useJarvis((s) => s.openSetup)
  useEffect(() => {
    if (firstRun) openSetup()
  }, [firstRun, openSetup])

  /**
   * A recognised command.
   *
   * Voice input is always sent straight away — nobody wants to have to press
   * send after talking to their assistant.
   */
  const handleVoiceCommand = useCallback(
    (text: string): void => {
      const value = text.trim()
      if (!value) return
      void send(value, "chat")
    },
    [send]
  )

  // Register the voice session's command handler.
  useEffect(() => {
    voiceSession.onCommand((text) => handleVoiceCommand(text))
  }, [handleVoiceCommand])

  /**
   * Mirror the voice session into the shared state, so the HUD and the
   * visualiser show that JARVIS is listening or speaking.
   */
  useEffect(() => {
    return voiceSession.subscribe((session) => {
      const current = useJarvis.getState().state
      // A reply being generated takes priority over the microphone.
      if (current === "thinking") return
      if (session.speaking) useJarvis.setState({ state: "speaking" })
      else if (session.listening) useJarvis.setState({ state: "listening" })
      else useJarvis.setState({ state: "idle" })
    })
  }, [])

  // Push to talk with the keyboard.
  usePushToTalk(ready, handleVoiceCommand)

  // Open the microphone straight away when always-on is switched on.
  const alwaysOn = settings?.voice.alwaysOn ?? false
  useEffect(() => {
    if (!ready || !settings) return
    if (!alwaysOn) {
      void voiceSession.setAlwaysOn(false)
      return
    }
    void voiceSession.setAlwaysOn(true, {
      wakeMode: settings.voice.wakeMode,
      wakeWord: settings.voice.wakeWord,
      wakeSensitivity: settings.voice.wakeSensitivity,
      silenceTimeoutMs: settings.voice.silenceTimeoutMs,
      inputDeviceId: settings.voice.inputDeviceId,
      sttEngine: settings.voice.sttEngine,
      language: settings.voice.language
    })
  }, [ready, alwaysOn, settings?.voice.wakeMode, settings?.voice.wakeWord, settings?.voice.inputDeviceId])

  // Development aid: send a prompt on launch so the chat can be exercised.
  const demoSentRef = useRef(false)
  useEffect(() => {
    if (!ready || demoSentRef.current) return
    demoSentRef.current = true
    void window.jarvis.app.demoPrompt().then((prompt) => {
      if (prompt) void send(prompt)
    })
  }, [ready, send])

  if (!ready) {
    return (
      <div className="empty" style={{ height: "100%" }}>
        <span className="material-symbols-outlined" style={{ animation: "spin 1.4s linear infinite" }}>
          progress_activity
        </span>
        <h3>Bringing systems online…</h3>
      </div>
    )
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "collapsed-sidebar" : ""} ${hudCollapsed ? "collapsed-hud" : ""}`}>
      <Sidebar />

      <main className="chat-column">
        <TopBar />
        <ChatPanel />
        <VoiceDock onCommand={handleVoiceCommand} />
        <Composer onSend={(text, mode) => void send(text, mode)} onCancel={() => void cancel()} busy={busy} />
      </main>

      {hudCollapsed ? <div /> : <Hud />}

      <StatusBar />

      <SettingsDialog />
      <SetupWizard />
      <VisualizerOverlay />

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
              {t.kind === "error" ? "error" : t.kind === "success" ? "check_circle" : "info"}
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
