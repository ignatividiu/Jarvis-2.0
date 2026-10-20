import { useEffect, useMemo, useRef, useState } from "react"
import { useJarvis } from "../state/store"
import { useVoice } from "../hooks/useVoice"
import { voiceSession, type SessionSettings } from "../audio/session"

/**
 * The voice dock.
 *
 * A single strip that controls everything about how JARVIS listens and
 * speaks:
 *
 *  - the **always-on** switch, which keeps the microphone open and waits for
 *    the wake word;
 *  - a **push to talk** button that records while it is held;
 *  - quick pickers for the **microphone** and the **speaker**.
 */
export function VoiceDock({ onCommand }: { onCommand: (text: string) => void }): React.ReactElement | null {
  const settings = useJarvis((s) => s.settings)
  const devices = useJarvis((s) => s.devices)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const refreshDevices = useJarvis((s) => s.refreshDevices)
  const refreshVoice = useJarvis((s) => s.refreshVoice)
  const toast = useJarvis((s) => s.toast)

  const voice = useVoice()
  const voiceStatus = useJarvis((s) => s.voice)
  const [menu, setMenu] = useState<"input" | "output" | null>(null)
  const holdTimer = useRef<number | null>(null)

  const wakeWord = settings?.voice.wakeWord ?? "jarvis"
  const alwaysOn = settings?.voice.alwaysOn ?? false
  const wakeMode = settings?.voice.wakeMode ?? "wake-word"

  /** Collect the settings the session cares about. */
  const sessionSettings = useMemo((): SessionSettings | null => {
    if (!settings) return null
    return {
      sttEngine: settings.voice.sttEngine,
      ttsEngine: voiceStatus?.activeEngine ?? "edge",
      alwaysOn: settings.voice.alwaysOn,
      wakeMode: settings.voice.wakeMode,
      wakeWord: settings.voice.wakeWord,
      wakeSensitivity: settings.voice.wakeSensitivity,
      silenceTimeoutMs: settings.voice.silenceTimeoutMs,
      inputDeviceId: settings.voice.inputDeviceId,
      outputDeviceId: settings.voice.outputDeviceId,
      rate: settings.voice.rate,
      pitch: settings.voice.pitch,
      volume: settings.voice.volume,
      language: settings.voice.language,
      browserVoice: settings.voice.browserVoice
    }
  }, [settings, voiceStatus?.activeEngine])

  // Keep the session in step with the stored settings.
  useEffect(() => {
    if (!sessionSettings) return
    void voiceSession.applySettings(sessionSettings)
  }, [sessionSettings])

  useEffect(() => {
    if (!settings) return
    voiceSession.setSettings({
      wakeMode: settings.voice.wakeMode,
      wakeWord: settings.voice.wakeWord,
      wakeSensitivity: settings.voice.wakeSensitivity,
      silenceTimeoutMs: settings.voice.silenceTimeoutMs,
      inputDeviceId: settings.voice.inputDeviceId,
      sttEngine: settings.voice.sttEngine,
      language: settings.voice.language
    })
  }, [settings])

  const inputs = devices?.inputs ?? []
  const outputs = devices?.outputs ?? []

  const inputLabel = useMemo(() => {
    const found = inputs.find((d) => d.deviceId === settings?.voice.inputDeviceId)
    return found?.label ?? (inputs.length ? "System microphone" : "No microphone found")
  }, [inputs, settings?.voice.inputDeviceId])

  const outputLabel = useMemo(() => {
    const found = outputs.find((d) => d.deviceId === settings?.voice.outputDeviceId)
    return found?.label ?? (outputs.length ? "System speaker" : "No speaker found")
  }, [outputs, settings?.voice.outputDeviceId])

  const toggleAlwaysOn = async (): Promise<void> => {
    if (!settings) return
    const next = !settings.voice.alwaysOn
    await updateSettings({ voice: { ...settings.voice, alwaysOn: next } })
    if (next) {
      if (settings.voice.wakeMode === "off") {
        toast("Always-on is on, but the wake mode is 'off' — set it to 'Wake word' in Settings → Voice.")
      }
      await voice.setAlwaysOn(true)
      toast(`Always-on is on. Say “${wakeWord}” to wake me.`)
    } else {
      await voice.setAlwaysOn(false)
      toast("Always-on is off.")
    }
  }

  const beginHold = async (): Promise<void> => {
    if (holdTimer.current !== null) return
    await voice.startPtt()
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
    }, 50)
  }

  const endHold = async (): Promise<void> => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    const text = await voice.endPtt()
    if (text.trim()) onCommand(text.trim())
  }

  const chooseInput = async (deviceId: string): Promise<void> => {
    if (!settings) return
    await updateSettings({ voice: { ...settings.voice, inputDeviceId: deviceId } })
    setMenu(null)
    // Reopen the microphone on the new device straight away.
    if (voice.listening) {
      await voiceSession.stopListening()
      await voiceSession.startListening(deviceId, settings.voice.sttEngine)
      if (settings.voice.alwaysOn) {
        await voiceSession.setAlwaysOn(true, {
          wakeMode: settings.voice.wakeMode,
          wakeWord: settings.voice.wakeWord,
          wakeSensitivity: settings.voice.wakeSensitivity,
          silenceTimeoutMs: settings.voice.silenceTimeoutMs,
          inputDeviceId: deviceId,
          sttEngine: settings.voice.sttEngine,
          language: settings.voice.language
        })
      }
    }
    await refreshDevices()
  }

  const chooseOutput = async (deviceId: string): Promise<void> => {
    if (!settings) return
    await updateSettings({ voice: { ...settings.voice, outputDeviceId: deviceId } })
    setMenu(null)
    if (sessionSettings) {
      await voiceSession.applySettings({ ...sessionSettings, outputDeviceId: deviceId })
    }
    toast("Speaker changed.")
  }

  if (!settings) return null

  const statusClass = voice.recording
    ? "recording"
    : voice.awake
      ? "awake"
      : voice.alwaysOn
        ? "armed"
        : voice.listening
          ? "live"
          : "off"

  return (
    <div className="voice-dock">
      <div className="voice-dock-main">
        {/* Always-on switch */}
        <button
          type="button"
          className={`voice-toggle ${alwaysOn ? "on" : ""}`}
          onClick={() => void toggleAlwaysOn()}
          title={alwaysOn ? "Stop listening for the wake word" : "Keep the microphone open and wait for the wake word"}
          aria-pressed={alwaysOn}
        >
          <span className="material-symbols-outlined">graphic_eq</span>
          <span className="voice-toggle-text">
            <b>Always on</b>
            <small>
              {wakeMode === "open"
                ? "answers every phrase"
                : wakeMode === "off"
                  ? "wake mode is off"
                  : `waits for “${wakeWord}”`}
            </small>
          </span>
          <span className="switch" aria-hidden="true">
            <i />
          </span>
        </button>

        {/* Push to talk */}
        <button
          type="button"
          className={`ptt-btn ${voice.recording ? "recording" : ""}`}
          onPointerDown={(e) => {
            e.preventDefault()
            void beginHold()
          }}
          onPointerUp={() => void endHold()}
          onPointerLeave={() => {
            if (voice.recording) void endHold()
          }}
          title={`Hold to talk (${settings.voice.pushToTalkKey})`}
        >
          <span className="material-symbols-outlined">{voice.recording ? "stop" : "mic"}</span>
          <span>{voice.recording ? "Listening…" : "Hold to talk"}</span>
        </button>

        <div className="spacer" />

        {/* Device pickers */}
        <div className="device-picker">
          <button
            type="button"
            className={`device-btn ${menu === "input" ? "open" : ""}`}
            onClick={() => setMenu(menu === "input" ? null : "input")}
            title="Choose the microphone JARVIS listens to"
          >
            <span className="material-symbols-outlined">settings_input_component</span>
            <span className="device-label">{inputLabel}</span>
          </button>
          {menu === "input" && (
            <div className="device-menu">
              {inputs.length === 0 && <div className="device-empty">No microphones were found.</div>}
              {inputs.map((d) => (
                <button
                  key={d.deviceId || d.label}
                  type="button"
                  className={`device-item ${d.deviceId === settings.voice.inputDeviceId ? "selected" : ""}`}
                  onClick={() => void chooseInput(d.deviceId)}
                >
                  <span className="material-symbols-outlined">
                    {d.deviceId === settings.voice.inputDeviceId ? "check" : "blank"}
                  </span>
                  {d.label}
                </button>
              ))}
              <button
                type="button"
                className="device-item"
                onClick={() => {
                  setMenu(null)
                  void refreshDevices()
                  void refreshVoice()
                }}
              >
                <span className="material-symbols-outlined">refresh</span>
                Rescan devices
              </button>
            </div>
          )}
        </div>

        <div className="device-picker">
          <button
            type="button"
            className={`device-btn ${menu === "output" ? "open" : ""}`}
            onClick={() => setMenu(menu === "output" ? null : "output")}
            title="Choose the speaker JARVIS talks through"
          >
            <span className="material-symbols-outlined">speaker</span>
            <span className="device-label">{outputLabel}</span>
          </button>
          {menu === "output" && (
            <div className="device-menu">
              {outputs.length === 0 && <div className="device-empty">No speakers were found.</div>}
              {outputs.map((d) => (
                <button
                  key={d.deviceId || d.label}
                  type="button"
                  className={`device-item ${d.deviceId === settings.voice.outputDeviceId ? "selected" : ""}`}
                  onClick={() => void chooseOutput(d.deviceId)}
                >
                  <span className="material-symbols-outlined">
                    {d.deviceId === settings.voice.outputDeviceId ? "check" : "blank"}
                  </span>
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className={`voice-status ${statusClass}`} title="Microphone status">
          <i />
          {voice.recording
            ? "recording"
            : voice.awake
              ? "awake"
              : voice.alwaysOn
                ? "listening"
                : voice.listening
                  ? "mic open"
                  : "mic closed"}
        </span>
      </div>
    </div>
  )
}
