import { useMemo } from "react"
import type { UiMessage } from "@shared/types"
import { renderMarkdown } from "../../lib/markdown"

export function MessageBubble({ message }: { message: UiMessage }): React.ReactElement {
  const html = useMemo(() => (message.error ? "" : renderMarkdown(message.content)), [message.content, message.error])
  const isUser = message.role === "user"

  return (
    <div className={`msg ${isUser ? "user" : "assistant"}`}>
      <div className="msg-avatar">{isUser ? "YOU" : "AI"}</div>
      <div className="msg-body">
        <div className="msg-meta">
          {isUser ? "You" : "JARVIS"}
          {message.model ? ` · ${message.model}` : ""}
          {message.provider ? ` · ${message.provider}` : ""}
          {message.durationMs ? ` · ${(message.durationMs / 1000).toFixed(1)}s` : ""}
        </div>

        {message.error ? (
          <div className="msg-error">{message.error}</div>
        ) : (
          <div className="msg-text" dangerouslySetInnerHTML={{ __html: html }} />
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="tool-strip">
            {message.toolCalls.map((t, i) => (
              <span key={`${t.name}-${i}`} className="tool-pill ok">
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
