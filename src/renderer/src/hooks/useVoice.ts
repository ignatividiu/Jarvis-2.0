import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { voiceSession, type VoiceSessionState } from "../audio/session"

/**
 * A thin React binding over the voice session.
 *
 * The session is a singleton so that the HUD, the composer and the settings
 * dialog all share one microphone. This hook simply subscribes to it.
 */
export function useVoice(): {
  state: VoiceSessionState
  listening: boolean
  alwaysOn: boolean
  recording: boolean
  transcribing: boolean
  speaking: boolean
  awake: boolean
  level: number
  lastTranscript: string
  error?: string
  startListening: (deviceId?: string) => Promise<void>
  stopListening: () => Promise<void>
  setAlwaysOn: (on: boolean) => Promise<void>
  startPtt: (deviceId?: string) => Promise<void>
  endPtt: () => Promise<string>
  speak: (text: string) => Promise<boolean>
  stopSpeaking: () => void
} {
  const state = useSyncExternalStore(
    (listener) => voiceSession.subscribe(listener),
    () => voiceSession.getState(),
    () => voiceSession.getState()
  )

  const startListening = useCallback((deviceId?: string): Promise<void> => {
    return voiceSession.startListening(deviceId ?? "")
  }, [])

  const stopListening = useCallback((): Promise<void> => voiceSession.stopListening(), [])

  const setAlwaysOn = useCallback(async (on: boolean): Promise<void> => {
    const settings = await window.jarvis.settings.get()
    await voiceSession.setAlwaysOn(on, {
      wakeMode: settings.voice.wakeMode,
      wakeWord: settings.voice.wakeWord,
      wakeSensitivity: settings.voice.wakeSensitivity,
      silenceTimeoutMs: settings.voice.silenceTimeoutMs,
      inputDeviceId: settings.voice.inputDeviceId,
      sttEngine: settings.voice.sttEngine,
      language: settings.voice.language
    })
  }, [])

  const startPtt = useCallback(async (deviceId?: string): Promise<void> => {
    const settings = await window.jarvis.settings.get()
    await voiceSession.startPtt(deviceId ?? settings.voice.inputDeviceId, settings.voice.sttEngine)
  }, [])

  const endPtt = useCallback((): Promise<string> => voiceSession.endPtt(), [])

  const speak = useCallback(async (text: string): Promise<boolean> => voiceSession.speak(text), [])

  const stopSpeaking = useCallback((): void => voiceSession.stopSpeaking(), [])

  return {
    state,
    listening: state.listening,
    alwaysOn: state.alwaysOn,
    recording: state.recording,
    transcribing: state.transcribing,
    speaking: state.speaking,
    awake: state.awake,
    level: state.level,
    lastTranscript: state.lastTranscript,
    error: state.error,
    startListening,
    stopListening,
    setAlwaysOn,
    startPtt,
    endPtt,
    speak,
    stopSpeaking
  }
}

/**
 * The push-to-talk keyboard shortcut.
 *
 * The combination is configurable — "Ctrl+Space" by default. Holding it
 * records, releasing it transcribes and sends the command.
 */
export function usePushToTalk(enabled: boolean, onCommand: (text: string) => void): void {
  const [combination, setCombination] = useState("Ctrl+Space")
  const heldRef = useRef(false)

  useEffect(() => {
    void window.jarvis.settings.get().then((settings) => {
      setCombination(settings.voice.pushToTalkKey)
      // Prime the session so the shortcut uses the configured microphone
      // rather than the system default.
      voiceSession.setSettings({
        wakeMode: settings.voice.wakeMode,
        wakeWord: settings.voice.wakeWord,
        wakeSensitivity: settings.voice.wakeSensitivity,
        silenceTimeoutMs: settings.voice.silenceTimeoutMs,
        inputDeviceId: settings.voice.inputDeviceId,
        sttEngine: settings.voice.sttEngine,
        language: settings.voice.language
      })
    })
  }, [])

  useEffect(() => {
    if (!enabled) return

    const matches = (event: KeyboardEvent): boolean => {
      const parts = combination.split("+").map((p) => p.trim().toLowerCase())
      const key = parts[parts.length - 1]
      const modifiers = parts.slice(0, -1)

      const wantCtrl = modifiers.includes("ctrl") || modifiers.includes("control")
      const wantAlt = modifiers.includes("alt") || modifiers.includes("option")
      const wantShift = modifiers.includes("shift")
      const wantMeta = modifiers.includes("meta") || modifiers.includes("cmd") || modifiers.includes("command")

      if (event.ctrlKey !== wantCtrl) return false
      if (event.altKey !== wantAlt) return false
      if (event.shiftKey !== wantShift) return false
      if (event.metaKey !== wantMeta) return false

      return event.key.toLowerCase() === key || event.code.toLowerCase() === `key${key}`
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (heldRef.current) return
      if (!matches(event)) return
      // Do not steal the shortcut from a text field.
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return
      }
      event.preventDefault()
      heldRef.current = true
      void voiceSession.startPtt()
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (!heldRef.current) return
      if (!matches(event)) return
      heldRef.current = false
      void voiceSession.endPtt().then((text) => {
        if (text.trim()) onCommand(text.trim())
      })
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [enabled, combination, onCommand])
}
