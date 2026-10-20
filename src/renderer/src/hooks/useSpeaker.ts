import { useEffect, useRef } from "react"
import { useJarvis } from "../state/store"
import { toPlainText } from "../lib/markdown"
import { useVoice } from "./useVoice"

/**
 * The messages that have already been spoken.
 *
 * Module-level so a message is never spoken twice, even if the component that
 * owns the speaker is mounted more than once.
 */
const spoken = new Set<string>()

/**
 * Speaks completed assistant messages.
 *
 * A reply that arrived while the window was in the background is still
 * spoken, because the store keeps the whole conversation.
 */
export function useSpeaker(): void {
  const messages = useJarvis((s) => s.messages)
  const speak = useVoice().speak
  const enabled = useJarvis((s) => s.settings?.persona.speak)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    // Only the newest message matters: older ones were handled already.
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant" || last.error) return
    if (!last.content.trim()) return
    if (spoken.has(last.id)) return

    spoken.add(last.id)
    if (!startedRef.current) {
      startedRef.current = true
      console.info(`[jarvis] speaking the reply: ${last.content.slice(0, 60)}`)
    }
    void speak(toPlainText(last.content))
  }, [messages, enabled, speak])
}
