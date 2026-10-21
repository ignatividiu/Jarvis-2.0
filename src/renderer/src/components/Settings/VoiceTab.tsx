import { useEffect, useMemo, useState } from "react"
import { useJarvis } from "../../state/store"
import { audioEngine } from "../../audio/engine"
import { speakWithBrowser } from "../../audio/speech"
import { playMissCue, playWakeCue } from "../../audio/cue"
import type { VoiceOption } from "@shared/types"

const ENGINES = [
  { id: "auto", label: "Automatic", hint: "Online first, offline second, system voice last" },
  { id: "edge", label: "Edge (online)", hint: "Best sounding. Free, no account, needs internet" },
  { id: "piper", label: "Piper (offline)", hint: "Fully offline. Downloaded on demand" },
  { id: "browser", label: "System voice", hint: "Always available, quality varies" }
] as const

const STT_ENGINES = [
  { id: "auto", label: "Automatic", hint: "Local Whisper when it is installed" },
  { id: "whisper", label: "Local Whisper", hint: "Private, offline, works on any accent" },
  { id: "browser", label: "Browser recogniser", hint: "No download, but less reliable" }
] as const

const WAKE_MODES = [
  { id: "wake-word", label: "Wake word", hint: "Only answer after you say the wake word" },
  { id: "open", label: "Open", hint: "Answer every phrase you say" },
  { id: "off", label: "Off", hint: "Always-on listening is disabled" }
] as const

export function VoiceTab(): React.ReactElement | null {
  const settings = useJarvis((s) => s.settings)
  const voice = useJarvis((s) => s.voice)
  const updateSettings = useJarvis((s) => s.updateSettings)
  const refreshVoice = useJarvis((s) => s.refreshVoice)
  const toast = useJarvis((s) => s.toast)

  const [testing, setTesting] = useState(false)
  const [busyModel, setBusyModel] = useState<string | null>(null)
  const [busyPiper, setBusyPiper] = useState(false)
  const [search, setSearch] = useState("")

  useEffect(() => {
    void refreshVoice()
  }, [refreshVoice])

  const voices = voice?.voices ?? []

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = needle
      ? voices.filter(
          (v) =>
            v.name.toLowerCase().includes(needle) ||
            v.id.toLowerCase().includes(needle) ||
            v.language.toLowerCase().includes(needle)
        )
      : voices
    // Put the JARVIS-like voices at the top, then the rest alphabetically.
    return [...list].sort((a, b) => {
      if (a.jarvisLike !== b.jarvisLike) return a.jarvisLike ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [voices, search])

  const grouped = useMemo(() => {
    const map = new Map<string, VoiceOption[]>()
    for (const v of filtered) {
      const key = v.engine === "edge" ? "Online (Edge)" : v.engine === "piper" ? "Offline (Piper)" : "System"
      const list = map.get(key) ?? []
      list.push(v)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [filtered])

  if (!settings) return null
  const v = settings.voice

  const setVoice = (patch: Partial<typeof v>): void => {
    void updateSettings({ voice: { ...v, ...patch } })
  }

  const testVoice = async (): Promise<void> => {
    setTesting(true)
    try {
      const result = await window.jarvis.voice.speak({
        text: "All systems online. I am JARVIS, and I am at your service."
      })
      if (result.ok && result.clipId) {
        const buffer = await audioEngine.decode(`jarvismedia://speech/${encodeURIComponent(result.clipId)}`)
        if (buffer) await audioEngine.playBuffer(buffer)
        else toast("The voice was generated but could not be played.", "error")
      } else if (result.ok && result.engine === "browser") {
        await speakWithBrowser("All systems online. I am JARVIS, and I am at your service.", {
          rate: v.rate,
          pitch: v.pitch,
          volume: v.volume,
          lang: v.language
        })
      } else {
        toast(result.error ?? "The voice could not be generated.", "error")
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setTesting(false)
    }
  }

  const downloadModel = async (modelId: string): Promise<void> => {
    setBusyModel(modelId)
    try {
      const result = await window.jarvis.voice.downloadModel(modelId)
      toast(result.message, result.ok ? "success" : "error")
      await refreshVoice()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusyModel(null)
    }
  }

  const installPiper = async (): Promise<void> => {
    setBusyPiper(true)
    try {
      const voiceId = voices.find((x) => x.engine === "piper" && x.jarvisLike)?.id ?? "en_GB-alan-medium"
      const result = await window.jarvis.voice.installPiper(voiceId)
      toast(result.message, result.ok ? "success" : "error")
      await refreshVoice()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusyPiper(false)
    }
  }

  const removePiper = async (): Promise<void> => {
    setBusyPiper(true)
    try {
      const result = await window.jarvis.voice.uninstallPiper()
      toast(result.message, result.ok ? "success" : "error")
      await refreshVoice()
    } finally {
      setBusyPiper(false)
    }
  }

  return (
    <>
      <h4>Speaking</h4>
      <p className="sub">
        JARVIS speaks with the Edge read-aloud service by default — it is free, needs no account, and the
        British voices are excellent. Install the offline engine as well so the assistant still works without
        an internet connection.
      </p>

      <div className="grid-2">
        <div className="field">
          <label>Voice engine</label>
          <select value={v.engine} onChange={(e) => setVoice({ engine: e.target.value as typeof v.engine })}>
            {ENGINES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <span className="hint">{ENGINES.find((e) => e.id === v.engine)?.hint}</span>
        </div>

        <div className="field">
          <label>Language</label>
          <select value={v.language} onChange={(e) => setVoice({ language: e.target.value })}>
            <option value="en-GB">English (United Kingdom)</option>
            <option value="en-US">English (United States)</option>
            <option value="en-AU">English (Australia)</option>
            <option value="en-IN">English (India)</option>
            <option value="de-DE">Deutsch</option>
            <option value="fr-FR">Francais</option>
            <option value="es-ES">Espanol</option>
            <option value="it-IT">Italiano</option>
            <option value="pt-BR">Portugues (Brasil)</option>
            <option value="nl-NL">Nederlands</option>
            <option value="pl-PL">Polski</option>
            <option value="ru-RU">Russkij</option>
            <option value="ja-JP">Nihongo</option>
            <option value="ko-KR">Hangugeo</option>
            <option value="zh-CN">Zhongwen (Jian ti)</option>
          </select>
          <span className="hint">Sets the accent of the generated speech.</span>
        </div>
      </div>

      <div className="field">
        <label>Active voice</label>
        <input
          type="search"
          placeholder="Search voices…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "9px 12px",
            borderRadius: "10px",
            border: "1px solid var(--jarvis-line)",
            background: "var(--jarvis-surface)",
            color: "var(--jarvis-text)",
            marginBottom: "10px"
          }}
        />

        {grouped.length === 0 && <p className="sub">No voices matched “{search}”.</p>}

        {grouped.map(([group, list]) => (
          <div key={group} style={{ marginBottom: "14px" }}>
            <div className="sidebar-label" style={{ marginBottom: "6px" }}>
              {group}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {list.slice(0, 60).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`btn sm ${v.voiceId === option.id ? "primary" : "ghost"}`}
                  onClick={() => setVoice({ voiceId: option.id })}
                  title={option.id}
                >
                  {option.jarvisLike && (
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                      star
                    </span>
                  )}
                  {option.name}
                </button>
              ))}
            </div>
            {list.length > 60 && <span className="hint">Showing the first 60 of {list.length}.</span>}
          </div>
        ))}

        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button type="button" className="btn sm" onClick={() => void testVoice()} disabled={testing}>
            <span className="material-symbols-outlined">volume_up</span>
            {testing ? "Playing…" : "Test the voice"}
          </button>
          <button type="button" className="btn sm ghost" onClick={() => void refreshVoice()}>
            <span className="material-symbols-outlined">refresh</span>
            Refresh the list
          </button>
        </div>
      </div>

      <div className="grid-3">
        <div className="field">
          <label>Speed — {v.rate.toFixed(2)}x</label>
          <input
            type="range"
            min="0.6"
            max="1.6"
            step="0.05"
            value={v.rate}
            onChange={(e) => setVoice({ rate: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Pitch — {v.pitch.toFixed(2)}</label>
          <input
            type="range"
            min="0.6"
            max="1.4"
            step="0.05"
            value={v.pitch}
            onChange={(e) => setVoice({ pitch: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Volume — {Math.round(v.volume * 100)}%</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={v.volume}
            onChange={(e) => setVoice({ volume: Number(e.target.value) })}
          />
        </div>
      </div>

      <h4>Offline voice engine</h4>
      <p className="sub">
        Piper is a small, entirely offline speech engine. Once it is installed JARVIS can talk with no internet
        connection at all — useful on a laptop in aeroplane mode or on a machine behind a firewall.
      </p>
      <div className="row" style={{ gap: 8 }}>
        {voice?.piperInstalled ? (
          <>
            <span className="banner good">
              <span className="material-symbols-outlined">check_circle</span>
              The offline engine is installed.
            </span>
            <button type="button" className="btn sm ghost" onClick={() => void removePiper()} disabled={busyPiper}>
              Remove
            </button>
          </>
        ) : (
          <button type="button" className="btn sm" onClick={() => void installPiper()} disabled={busyPiper}>
            <span className="material-symbols-outlined">download</span>
            {busyPiper ? "Downloading…" : "Install the offline engine"}
          </button>
        )}
        <button type="button" className="btn sm ghost" onClick={() => void window.jarvis.voice.openPiper()}>
          About Piper
        </button>
      </div>

      <h4>Listening</h4>
      <p className="sub">
        Speech recognition runs on a local Whisper model. Nothing you say is sent anywhere — the audio never
        leaves this machine.
      </p>

      <div className="grid-2">
        <div className="field">
          <label>Recogniser</label>
          <select value={v.sttEngine} onChange={(e) => setVoice({ sttEngine: e.target.value as typeof v.sttEngine })}>
            {STT_ENGINES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <span className="hint">{STT_ENGINES.find((e) => e.id === v.sttEngine)?.hint}</span>
        </div>

        <div className="field">
          <label>Wake behaviour</label>
          <select value={v.wakeMode} onChange={(e) => setVoice({ wakeMode: e.target.value as typeof v.wakeMode })}>
            {WAKE_MODES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <span className="hint">{WAKE_MODES.find((e) => e.id === v.wakeMode)?.hint}</span>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>Trigger phrase</label>
          <input
            type="text"
            value={v.wakeWord}
            placeholder="Hey jarvis"
            onChange={(e) => setVoice({ wakeWord: e.target.value })}
          />
          <span className="hint">
            The phrase that wakes JARVIS. It may be more than one word. The leading filler is optional, so
            “Jarvis, what time is it” works too.
          </span>
        </div>

        <div className="field">
          <label>Push-to-talk key</label>
          <input
            type="text"
            value={v.pushToTalkKey}
            placeholder="Ctrl+Space"
            onChange={(e) => setVoice({ pushToTalkKey: e.target.value })}
          />
          <span className="hint">Hold this key anywhere in the window to talk.</span>
        </div>
      </div>

      <div className="field">
        <label>Confirmation sound</label>
        <div className="row" style={{ gap: 10 }}>
          <select
            value={v.wakeCue ? "on" : "off"}
            onChange={(e) => setVoice({ wakeCue: e.target.value === "on" })}
            style={{ flex: 1 }}
          >
            <option value="on">On — a chime when the trigger is heard, a soft note when it is missed</option>
            <option value="off">Off — no sound</option>
          </select>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              void playWakeCue()
              setTimeout(() => void playMissCue(), 700)
            }}
            title="Play the confirmation sound"
          >
            <span className="material-symbols-outlined">volume_up</span>
            Test
          </button>
        </div>
        <span className="hint">
          Without a sound there is no way to tell whether the trigger was picked up, which is why it can feel
          as though it is not working.
        </span>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>Sensitivity — {Math.round(v.wakeSensitivity * 100)}%</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={v.wakeSensitivity}
            onChange={(e) => setVoice({ wakeSensitivity: Number(e.target.value) })}
          />
          <span className="hint">Higher values trigger more easily, but pick up more background noise.</span>
        </div>

        <div className="field">
          <label>End of phrase — {(v.silenceTimeoutMs / 1000).toFixed(1)} s</label>
          <input
            type="range"
            min="500"
            max="3000"
            step="100"
            value={v.silenceTimeoutMs}
            onChange={(e) => setVoice({ silenceTimeoutMs: Number(e.target.value) })}
          />
          <span className="hint">How long JARVIS waits for the rest of your sentence.</span>
        </div>
      </div>

      <h4>Speech models</h4>
      <p className="sub">
        The recognition model is downloaded once and then cached on this machine. “Whisper Tiny” is enough for
        the wake word; “Whisper Base” is noticeably better with accents and names.
      </p>
      <div className="provider-models">
        {(voice?.models ?? []).map((m) => (
          <div key={m.id} className="row spread" style={{ padding: "6px 0" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{m.label}</div>
              <div className="hint" style={{ maxWidth: "520px" }}>
                {m.description} · about {Math.round(m.sizeBytes / 1_000_000)} MB
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {m.installed ? (
                <>
                  <span className="banner good">
                    <span className="material-symbols-outlined">check</span>
                    Installed
                  </span>
                  <button
                    type="button"
                    className={`btn sm ${v.sttModel === m.id ? "primary" : "ghost"}`}
                    onClick={() => setVoice({ sttModel: m.id })}
                  >
                    {v.sttModel === m.id ? "In use" : "Use"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void downloadModel(m.id)}
                  disabled={busyModel === m.id}
                >
                  <span className="material-symbols-outlined">download</span>
                  {busyModel === m.id ? "Downloading…" : "Download"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <h4>Delivery</h4>
      <div className="field">
        <label>How JARVIS should sound</label>
        <textarea rows={3} value={v.instruct} onChange={(e) => setVoice({ instruct: e.target.value })} />
        <span className="hint">A short description of the delivery you want.</span>
      </div>
    </>
  )
}
