import { useEffect, useRef, useState } from "react"
import { useJarvis } from "../../state/store"
import { useVoice } from "../../hooks/useVoice"

interface Props {
  onSend: (text: string, mode: "chat" | "code") => void
  onCancel: () => void
  busy: boolean
}

export function Composer({ onSend, onCancel, busy }: Props): React.ReactElement {
  const [text, setText] = useState("")
  const [mode, setMode] = useState<"chat" | "code">("chat")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const voice = useVoice()
  const settings = useJarvis((s) => s.settings)
  const updateSettings = useJarvis((s) => s.updateSettings)

  // Auto-grow the textarea.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  // Focus the composer on load.
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const submit = (): void => {
    const value = text.trim()
    if (!value || busy) return
    onSend(value, mode)
    setText("")
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  /** Hold the microphone button to talk; release to send. */
  const beginTalk = (): void => {
    void voice.startPtt()
  }

  const endTalk = (): void => {
    void voice.endPtt().then((transcript) => {
      if (!transcript.trim()) return
      onSend(transcript.trim(), mode)
    })
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            voice.recording
              ? "Listening… speak now"
              : voice.transcribing
                ? "Transcribing…"
                : "Ask JARVIS anything, or hold the mic to talk."
          }
          rows={1}
          aria-label="Message JARVIS"
        />

        <div className="composer-actions">
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className={`btn sm ${mode === "code" ? "primary" : "ghost"}`}
              onClick={() => setMode(mode === "code" ? "chat" : "code")}
              title={mode === "code" ? "Routing to the OpenCode coding agent" : "Route to the OpenCode coding agent"}
            >
              <span className="material-symbols-outlined">code</span>
              {mode === "code" ? "Code agent" : "Chat"}
            </button>
            <button
              type="button"
              className={`btn sm ${voice.alwaysOn ? "primary" : "ghost"}`}
              onClick={() => {
                if (!settings) return
                const next = !settings.voice.alwaysOn
                // Persist the choice, then arm or disarm the session.
                void updateSettings({ voice: { ...settings.voice, alwaysOn: next } })
                void voice.setAlwaysOn(next)
              }}
              title={
                voice.alwaysOn
                  ? `Always-on is on — waiting for “${settings?.voice.wakeWord ?? "jarvis"}”`
                  : "Keep the microphone open and wait for the wake word"
              }
            >
              <span className="material-symbols-outlined">graphic_eq</span>
              Always on
            </button>
          </div>

          <span className="composer-hint">
            {voice.alwaysOn
              ? `Listening for “${settings?.voice.wakeWord ?? "jarvis"}”`
              : settings?.rotation.strategy === "round-robin"
                ? "Rotating across free models"
                : `Strategy: ${settings?.rotation.strategy}`}
          </span>

          <div className="spacer" />

          <button
            type="button"
            className={`mic-btn ${voice.recording ? "recording" : ""}`}
            onPointerDown={(e) => {
              e.preventDefault()
              beginTalk()
            }}
            onPointerUp={endTalk}
            onPointerLeave={() => {
              if (voice.recording) endTalk()
            }}
            title={voice.recording ? "Release to send" : "Hold to talk to JARVIS"}
            aria-label={voice.recording ? "Release to send" : "Hold to talk"}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 19 }}>
              {voice.recording ? "stop" : voice.transcribing ? "hourglass_top" : "mic"}
            </span>
          </button>

          {busy ? (
            <button type="button" className="send-btn" onClick={onCancel} title="Stop">
              <span className="material-symbols-outlined" style={{ fontSize: 19 }}>stop</span>
            </button>
          ) : (
            <button type="button" className="send-btn" onClick={submit} disabled={!text.trim()} title="Send">
              <span className="material-symbols-outlined" style={{ fontSize: 19 }}>arrow_upward</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
