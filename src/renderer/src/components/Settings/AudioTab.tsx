import { useEffect, useState } from "react"
import { useJarvis } from "../../state/store"
import { voiceSession } from "../../audio/session"
import type { AudioDevices } from "@shared/types"

/**
 * Audio devices.
 *
 * The microphone JARVIS listens through and the speaker it talks through are
 * both selectable. The list is refreshed whenever the dialog opens, because
 * Chromium only reveals device names once the microphone has been granted
 * permission at least once.
 */
export function AudioTab(): React.ReactElement | null {
  const settings = useJarvis((s) => s.settings)
  const devices = useJarvis((s) => s.devices)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const refreshDevices = useJarvis((s) => s.refreshDevices)
  const toast = useJarvis((s) => s.toast)

  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

  if (!settings) return null
  const v = settings.voice

  const setVoice = (patch: Partial<typeof v>): void => {
    void updateSettings({ voice: { ...v, ...patch } })
  }

  /** Keep the store in step with a fresh device list. */
  const setDevicesLocally = (value: AudioDevices): void => {
    useJarvis.setState({ devices: value })
  }

  /** Open the microphone once so the device names become visible. */
  const requestPermission = async (): Promise<void> => {
    setBusy(true)
    try {
      await voiceSession.startListening(v.inputDeviceId, v.sttEngine)
      const failure = voiceSession.getState().error
      if (failure) {
        toast(failure, "error")
        return
      }
      const updated = await window.jarvis.audio.devices()
      setDevicesLocally(updated)
      toast(
        updated.permitted
          ? "Microphone access granted."
          : "The device names may still be hidden by the operating system.",
        updated.permitted ? "success" : "info"
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      // The microphone was only opened to reveal the device names — it is
      // closed again so the operating system does not keep recording.
      await voiceSession.stopListening()
      setBusy(false)
    }
  }

  const chooseInput = async (deviceId: string): Promise<void> => {
    setVoice({ inputDeviceId: deviceId })
    if (voiceSession.getState().listening) {
      await voiceSession.stopListening()
      await voiceSession.startListening(deviceId, v.sttEngine)
      if (v.alwaysOn) {
        await voiceSession.setAlwaysOn(true, {
          wakeMode: v.wakeMode,
          wakeWord: v.wakeWord,
          wakeSensitivity: v.wakeSensitivity,
          silenceTimeoutMs: v.silenceTimeoutMs,
          inputDeviceId: deviceId,
          sttEngine: v.sttEngine,
          language: v.language
        })
      }
    }
  }

  const chooseOutput = async (deviceId: string): Promise<void> => {
    setVoice({ outputDeviceId: deviceId })
    await voiceSession.applySettings({
      sttEngine: v.sttEngine,
      ttsEngine: "edge",
      alwaysOn: v.alwaysOn,
      wakeMode: v.wakeMode,
      wakeWord: v.wakeWord,
      wakeSensitivity: v.wakeSensitivity,
      silenceTimeoutMs: v.silenceTimeoutMs,
      inputDeviceId: v.inputDeviceId,
      outputDeviceId: deviceId,
      rate: v.rate,
      pitch: v.pitch,
      volume: v.volume,
      language: v.language,
      browserVoice: v.browserVoice
    })
    toast("Speaker changed.")
  }

  const inputs = devices?.inputs ?? []
  const outputs = devices?.outputs ?? []

  return (
    <>
      <h4>Input</h4>
      <p className="sub">
        The microphone JARVIS listens to. Echo cancellation and noise suppression stay on, so a headset or a
        laptop microphone both work well.
      </p>

      <div className="field">
        <label>Microphone</label>
        {inputs.length === 0 ? (
          <div className="banner info">
            <span className="material-symbols-outlined">info</span>
            No microphones were found. Allow microphone access to see the list.
          </div>
        ) : (
          <select value={v.inputDeviceId} onChange={(e) => void chooseInput(e.target.value)}>
            <option value="">System default</option>
            {inputs.map((d) => (
              <option key={d.deviceId || d.label} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}
        <span className="hint">The default entry follows whatever the operating system is using.</span>
      </div>

      <h4>Output</h4>
      <p className="sub">
        The speaker JARVIS talks through. Generated speech is routed with the Web Audio API, so the choice
        applies to every engine.
      </p>

      <div className="field">
        <label>Speaker</label>
        {outputs.length === 0 ? (
          <div className="banner info">
            <span className="material-symbols-outlined">info</span>
            No speakers were found. Allow microphone access to see the list.
          </div>
        ) : (
          <select value={v.outputDeviceId} onChange={(e) => void chooseOutput(e.target.value)}>
            <option value="">System default</option>
            {outputs.map((d) => (
              <option key={d.deviceId || d.label} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}
        <span className="hint">
          {devices?.canSelectOutput
            ? "The system speech engine always uses the default speaker."
            : "This platform cannot redirect the generated audio."}
        </span>
      </div>

      <div className="row" style={{ gap: 8, marginTop: "10px" }}>
        <button type="button" className="btn sm" onClick={() => void requestPermission()} disabled={busy}>
          <span className="material-symbols-outlined">mic</span>
          {busy ? "Opening…" : "Allow microphone access"}
        </button>
        <button type="button" className="btn sm ghost" onClick={() => void refreshDevices()}>
          <span className="material-symbols-outlined">refresh</span>
          Rescan
        </button>
      </div>

      <h4>Diagnostics</h4>
      <div className="provider-models">
        <div className="row spread" style={{ padding: "6px 0" }}>
          <span>Microphone permission</span>
          <span className={`v ${devices?.permitted ? "good" : "warn"}`}>
            {devices?.permitted ? "granted" : "not granted"}
          </span>
        </div>
        <div className="row spread" style={{ padding: "6px 0" }}>
          <span>Microphones found</span>
          <span className="v">{inputs.length}</span>
        </div>
        <div className="row spread" style={{ padding: "6px 0" }}>
          <span>Speakers found</span>
          <span className="v">{outputs.length}</span>
        </div>
        <div className="row spread" style={{ padding: "6px 0" }}>
          <span>Redirecting the output</span>
          <span className={`v ${devices?.canSelectOutput ? "good" : "warn"}`}>
            {devices?.canSelectOutput ? "supported" : "not supported"}
          </span>
        </div>
      </div>
    </>
  )
}
