/**
 * Language helpers.
 *
 * Whisper's language tokens are two-letter codes — "en", "fr", "de". It
 * does not know about regions, so a locale like "en-GB" has to be reduced
 * to "en" before it is handed over. Passing the full locale makes a
 * multilingual model fail outright.
 */

/**
 * Reduce a locale to the base language Whisper understands.
 *
 * Returns undefined for "auto" and for an empty value, which means "let the
 * model decide".
 */
export function toWhisperLanguage(language: string | undefined): string | undefined {
  if (!language) return undefined
  const clean = language.trim().toLowerCase()
  if (!clean || clean === "auto") return undefined
  const base = clean.split(/[-_]/)[0]
  return base || undefined
}

/** The languages Whisper can be asked for, with the locales that map onto them. */
export const LANGUAGE_GROUPS: Array<{ code: string; label: string; locales: string[] }> = [
  {
    code: "en",
    label: "English",
    locales: ["en-GB", "en-US", "en-AU", "en-IN", "en-CA", "en-IE", "en-NZ"]
  },
  { code: "es", label: "Espanol", locales: ["es-ES", "es-MX", "es-AR"] },
  { code: "fr", label: "Francais", locales: ["fr-FR", "fr-CA", "fr-BE"] },
  { code: "de", label: "Deutsch", locales: ["de-DE", "de-AT", "de-CH"] },
  { code: "it", label: "Italiano", locales: ["it-IT"] },
  { code: "pt", label: "Portugues", locales: ["pt-BR", "pt-PT"] },
  { code: "nl", label: "Nederlands", locales: ["nl-NL", "nl-BE"] },
  { code: "pl", label: "Polski", locales: ["pl-PL"] },
  { code: "ru", label: "Russkij", locales: ["ru-RU"] },
  { code: "uk", label: "Ukrainska", locales: ["uk-UA"] },
  { code: "cs", label: "Cestina", locales: ["cs-CZ"] },
  { code: "el", label: "Ellinika", locales: ["el-GR"] },
  { code: "sv", label: "Svenska", locales: ["sv-SE"] },
  { code: "da", label: "Dansk", locales: ["da-DK"] },
  { code: "fi", label: "Suomi", locales: ["fi-FI"] },
  { code: "nb", label: "Norsk", locales: ["nb-NO"] },
  { code: "tr", label: "Turkce", locales: ["tr-TR"] },
  { code: "ar", label: "Arabic", locales: ["ar-SA", "ar-EG"] },
  { code: "he", label: "Hebrew", locales: ["he-IL"] },
  { code: "hi", label: "Hindi", locales: ["hi-IN"] },
  { code: "id", label: "Bahasa Indonesia", locales: ["id-ID"] },
  { code: "ja", label: "Nihongo", locales: ["ja-JP"] },
  { code: "ko", label: "Hangugeo", locales: ["ko-KR"] },
  { code: "zh", label: "Zhongwen", locales: ["zh-CN", "zh-TW"] },
  { code: "th", label: "Thai", locales: ["th-TH"] },
  { code: "vi", label: "Tieng Viet", locales: ["vi-VN"] }
]
