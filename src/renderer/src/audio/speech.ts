/**
 * Browser speech fallback.
 *
 * Used when neither the online engine nor the offline engine is available.
 * The renderer speaks through the Web Speech API, which ships with Chromium
 * on Windows, macOS and Linux.
 *
 * Note that the system speech engine always uses the default output device —
 * the browser gives no way to route it to a different speaker.
 */

export interface BrowserVoice {
  name: string
  lang: string
  default: boolean
  localService: boolean
}

export function listBrowserVoices(): BrowserVoice[] {
  if (typeof speechSynthesis === "undefined") return []
  return speechSynthesis.getVoices().map((v) => ({
    name: v.name,
    lang: v.lang,
    default: v.default,
    localService: v.localService
  }))
}

/** Voices that sound closest to the classic JARVIS delivery. */
const JARVIS_LIKE = [
  "daniel",
  "google uk english male",
  "microsoft guy",
  "microsoft david",
  "arthur",
  "oliver",
  "fred",
  "alex",
  "thomas",
  "george",
  "ryan"
]

export function pickJarvisVoice(preferred?: string): BrowserVoice | null {
  const voices = listBrowserVoices()
  if (!voices.length) return null

  if (preferred) {
    const exact = voices.find((v) => v.name === preferred)
    if (exact) return exact
  }

  for (const needle of JARVIS_LIKE) {
    const match = voices.find((v) => v.name.toLowerCase().includes(needle))
    if (match) return match
  }

  // Prefer a British voice before falling back to any English voice.
  const british = voices.find((v) => v.lang.toLowerCase().startsWith("en-gb"))
  if (british) return british

  return voices.find((v) => v.lang.toLowerCase().startsWith("en")) ?? voices[0]
}

let current: SpeechSynthesisUtterance | null = null

export function speakWithBrowser(
  text: string,
  options: { voice?: string; rate?: number; pitch?: number; lang?: string; volume?: number } = {}
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined" || !text.trim()) {
      resolve()
      return
    }

    stopBrowserSpeech()

    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickJarvisVoice(options.voice)
    if (voice) utterance.voice = voicesByName(voice.name)
    utterance.rate = options.rate ?? 1
    utterance.pitch = options.pitch ?? 1
    utterance.volume = options.volume ?? 1
    utterance.lang = options.lang ?? "en-GB"
    utterance.onend = () => {
      current = null
      resolve()
    }
    utterance.onerror = () => {
      current = null
      resolve()
    }
    current = utterance
    speechSynthesis.speak(utterance)
  })
}

function voicesByName(name: string): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null
  return speechSynthesis.getVoices().find((v) => v.name === name) ?? null
}

export function stopBrowserSpeech(): void {
  if (typeof speechSynthesis !== "undefined") {
    try {
      speechSynthesis.cancel()
    } catch {
      /* ignore */
    }
  }
  current = null
}

export function isBrowserSpeaking(): boolean {
  return typeof speechSynthesis !== "undefined" && speechSynthesis.speaking
}

/** Chrome loads voices asynchronously. */
export function onVoicesLoaded(cb: () => void): void {
  if (typeof speechSynthesis === "undefined") return
  const existing = speechSynthesis.getVoices()
  if (existing.length) {
    cb()
    return
  }
  speechSynthesis.addEventListener("voiceschanged", cb, { once: true })
}
