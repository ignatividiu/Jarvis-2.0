import { useEffect, useRef } from "react"
import { useJarvis } from "../../state/store"
import { useChat } from "../../hooks/useChat"
import { MessageBubble } from "./MessageBubble"

const SUGGESTIONS = [
  "What are you capable of right now?",
  "Search the web for today's AI news",
  "Explain how model rotation works",
  "Write a Python script that organises files by extension"
]

export function ChatPanel(): React.ReactElement {
  const messages = useJarvis((s) => s.messages)
  const streamingText = useJarvis((s) => s.streamingText)
  const toolCalls = useJarvis((s) => s.toolCalls)
  const notice = useJarvis((s) => s.notice)
  const state = useJarvis((s) => s.state)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamingText])

  return (
    <div className="messages" ref={scrollRef}>
      <div className="messages-inner">
        {messages.length === 0 && !streamingText && (
          <div className="empty">
            <span className="material-symbols-outlined">graphic_eq</span>
            <h3>Systems nominal.</h3>
            <p className="muted">Ask a question, or use the microphone to talk.</p>
            <div className="row wrap" style={{ gap: 8, justifyContent: "center", marginTop: 10 }}>
              {SUGGESTIONS.map((s) => (
                <SuggestionChip key={s} text={s} />
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {(streamingText || toolCalls.length > 0 || state === "thinking") && (
          <div className="msg assistant">
            <div className="msg-avatar">AI</div>
            <div className="msg-body">
              {notice && <div className="tiny muted" style={{ marginBottom: 6 }}>{notice}</div>}
              {toolCalls.length > 0 && (
                <div className="tool-strip">
                  {toolCalls.map((t, i) => (
                    <span key={`${t.name}-${i}`} className={`tool-pill ${t.ok === true ? "ok" : t.ok === false ? "fail" : ""}`}>
                      {t.name}
                      {t.summary ? ` · ${t.summary}` : ""}
                    </span>
                  ))}
                </div>
              )}
              {streamingText ? (
                <div className="msg-text">{streamingText}</div>
              ) : (
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestionChip({ text }: { text: string }): React.ReactElement {
  const { send } = useChat()
  return (
    <button type="button" className="btn sm ghost" onClick={() => void send(text, "chat")}>
      {text}
    </button>
  )
}
