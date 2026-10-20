import { useCallback } from "react"
import type { UiMessage } from "@shared/types"
import { useJarvis, nextId } from "../state/store"

/**
 * Sends messages to the assistant and streams the reply back.
 * Shared by the composer and the suggestion chips.
 */
export function useChat() {
  const { messages, handleChunk, addMessage, settings, state, setState } = useJarvis()

  const send = useCallback(
    async (text: string, mode: "chat" | "code" = "chat"): Promise<void> => {
      const value = text.trim()
      if (!value) return

      const userMessage: UiMessage = {
        id: nextId("msg"),
        role: "user",
        content: value,
        createdAt: Date.now()
      }
      addMessage(userMessage)

      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

      try {
        await window.jarvis.chat.send({
          text: value,
          history,
          mode,
          directory: settings?.opencode.directory || undefined
        })
      } catch (err) {
        handleChunk({
          type: "error",
          error: err instanceof Error ? err.message : String(err)
        })
      }
    },
    [addMessage, handleChunk, messages, settings?.opencode.directory]
  )

  const cancel = useCallback(async (): Promise<void> => {
    await window.jarvis.chat.cancel()
    setState("idle")
  }, [setState])

  return { send, cancel, busy: state === "thinking" }
}
