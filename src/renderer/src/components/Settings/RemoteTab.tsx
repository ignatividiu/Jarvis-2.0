import { useEffect, useState } from "react"
import { useJarvis } from "../../state/store"
import type { RemoteStatus } from "@shared/types"

/**
 * Remote access.
 *
 * Lets another device — a phone, a tablet, another computer — talk to JARVIS
 * over the network. The page it serves has a chat box and a hold-to-talk
 * button, and the audio is recognised by the same local Whisper model.
 */
export function RemoteTab(): React.ReactElement | null {
  const settings = useJarvis((s) => s.settings)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const toast = useJarvis((s) => s.toast)

  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      setStatus(await window.jarvis.remote.status())
    } catch {
      /* the status is best effort */
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  if (!settings) return null
  const remote = settings.remote

  const setRemote = (patch: Partial<typeof remote>): void => {
    void updateSettings({ remote: { ...remote, ...patch } })
  }

  const toggle = async (): Promise<void> => {
    setBusy(true)
    try {
      if (remote.enabled) {
        setStatus(await window.jarvis.remote.stop())
        setRemote({ enabled: false })
        toast("Remote access is off.", "info")
      } else {
        const next = await window.jarvis.remote.start()
        setStatus(next)
        setRemote({ enabled: true })
        toast(
          next.running
            ? `Remote access is live on port ${next.port}.`
            : next.error ?? "The remote server could not start.",
          next.running ? "success" : "error"
        )
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const rotate = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await window.jarvis.remote.rotateToken()
      setStatus(next)
      setRemote({ token: next.token })
      toast("A new pairing token was generated.", "success")
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    const addresses = status?.addresses ?? []
    const target = addresses[0] ?? `http://127.0.0.1:${remote.port}`
    const link = `${target}/?token=${remote.token}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast("The link could not be copied — select it manually.", "error")
    }
  }

  const address = status?.addresses?.[0] ?? `http://127.0.0.1:${remote.port}`
  const link = `${address}/?token=${remote.token}`

  return (
    <>
      <h4>Remote access</h4>
      <p className="sub">
        Let another device talk to JARVIS over the network. The page it serves has a chat box and a
        hold-to-talk button; the audio is recognised by the same local Whisper model, so it works exactly as
        it does on this machine.
      </p>

      <div className="field">
        <label>Allow remote access</label>
        <div className="row" style={{ gap: 10 }}>
          <select
            value={remote.enabled ? "on" : "off"}
            onChange={(e) => {
              const on = e.target.value === "on"
              setRemote({ enabled: on })
              if (on) {
                void window.jarvis.remote.start().then((next) => {
                  setStatus(next)
                  if (!next.running) toast(next.error ?? "The remote server could not start.", "error")
                })
              } else {
                void window.jarvis.remote.stop().then(setStatus)
              }
            }}
            style={{ flex: 1 }}
          >
            <option value="off">Off — only this machine can reach JARVIS</option>
            <option value="on">On — JARVIS can be reached from the network</option>
          </select>
          <button type="button" className="btn sm" onClick={() => void toggle()} disabled={busy}>
            <span className="material-symbols-outlined">power_settings_new</span>
            {remote.enabled ? "Stop" : "Start"}
          </button>
        </div>
        <span className="hint">
          {status?.running
            ? `The server is listening on port ${status.port}.`
            : "The server is not running."}
        </span>
      </div>

      <div className="field">
        <label>Port</label>
        <input
          type="number"
          min={1024}
          max={65535}
          value={remote.port}
          onChange={(e) => setRemote({ port: Number(e.target.value) || 8765 })}
        />
        <span className="hint">The port the server listens on. Restart the app for a change to take effect.</span>
      </div>

      <div className="field">
        <label>Restrict to the local network</label>
        <select
          value={remote.localNetworkOnly ? "on" : "off"}
          onChange={(e) => setRemote({ localNetworkOnly: e.target.value === "on" })}
        >
          <option value="on">On — only devices on this network may connect</option>
          <option value="off">Off — reachable from anywhere, with the token</option>
        </select>
        <span className="hint">
          Turning this off exposes JARVIS to the internet. The pairing token is the only thing protecting it, so
          use a long one and share it only with people you trust.
        </span>
      </div>

      <h4>Pairing</h4>
      <p className="sub">
        Open the link below on the other device. The token is part of the link, so the device is paired
        automatically.
      </p>

      <div className="field">
        <label>Address</label>
        <div className="row" style={{ gap: 8 }}>
          <input type="text" readOnly value={link} style={{ flex: 1, fontFamily: "var(--jarvis-mono)", fontSize: 12 }} />
          <button type="button" className="btn sm" onClick={() => void copy()}>
            <span className="material-symbols-outlined">content_copy</span>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {status?.addresses && status.addresses.length > 1 && (
          <div className="hint">
            Other addresses: {status.addresses.slice(1).join(", ")}
          </div>
        )}
      </div>

      <div className="field">
        <label>Pairing token</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="text"
            readOnly
            value={remote.token || "—"}
            style={{ flex: 1, fontFamily: "var(--jarvis-mono)", fontSize: 12 }}
          />
          <button type="button" className="btn sm" onClick={() => void rotate()} disabled={busy}>
            <span className="material-symbols-outlined">autorenew</span>
            New token
          </button>
        </div>
        <span className="hint">A new token immediately invalidates the old one.</span>
      </div>

      <div className="banner info">
        <span className="material-symbols-outlined">info</span>
        <div>
          The remote page is served by JARVIS itself and works in any browser. A phone on the same Wi-Fi is
          the usual case; the microphone button on that page is recognised by the local model, so no audio
          leaves the machine.
        </div>
      </div>
    </>
  )
}
