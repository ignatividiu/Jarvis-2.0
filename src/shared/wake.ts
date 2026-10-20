/**
 * Wake word detection.
 *
 * The assistant hears an utterance, the local recogniser turns it into text,
 * and this module decides whether the utterance was addressed to JARVIS.
 *
 * Speech recognisers rarely spell a name exactly the way it is written, so
 * the matcher accepts near-misses: "jarvis", "jarvus", "jervis", "jarvez"
 * and friends all count. A Levenshtein distance keeps the rule general
 * without needing a dictionary of every accent and mis-hearing.
 */

/** Minimum word length before fuzzy matching is allowed. */
const MIN_FUZZY_LENGTH = 4

/** Maximum edit distance that still counts as the wake word. */
const MAX_EDIT_DISTANCE = 2

/**
 * How many words from the start may contain the wake word.
 *
 * The name has to be near the beginning, so that "tell me about Jarvis"
 * does not wake the assistant up. Three words covers the usual openings —
 * "jarvis…", "hey jarvis…", "ok computer jarvis…" — without letting the
 * name appear in the middle of a sentence.
 */
const WAKE_WORD_WINDOW = 3

/** Fillers that may sit in front of the wake word. */
const LEADING_FILLERS = new Set(["hey", "hi", "hello", "ok", "okay", "yo", "computer", "assistant"])

/** Transcriptions that are commonly produced for "jarvis". */
const KNOWN_VARIANTS = new Set([
  "jarvis",
  "jarviss",
  "jarvise",
  "jarvuz",
  "jarvus",
  "jervis",
  "jarvez",
  "harvis",
  "javis",
  "jervus",
  "jarvy",
  "jarvy's",
  "jarvis's"
])

export interface WakeMatch {
  /** True when the wake word was found. */
  matched: boolean
  /** The utterance with the wake word (and its fillers) removed. */
  command: string
  /** The word that actually matched. */
  matchedWord?: string
}

/** Levenshtein distance between two words, with an early bail-out. */
export function editDistance(a: string, b: string, max = MAX_EDIT_DISTANCE): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1

  let previous = new Array<number>(b.length + 1)
  let current = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) previous[j] = j

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    let rowMin = current[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (current[j] < rowMin) rowMin = current[j]
    }
    if (rowMin > max) return max + 1
    const swap = previous
    previous = current
    current = swap
  }
  return previous[b.length]
}

/** Normalise a word: lower case, strip punctuation and possessive endings. */
export function normaliseWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9'’]/g, "")
    .replace(/['’]s$/, "")
    .replace(/['’]$/, "")
}

/** Is this word the wake word? */
export function isWakeWord(word: string, wakeWord: string): boolean {
  const candidate = normaliseWord(word)
  const target = normaliseWord(wakeWord)
  if (!candidate || !target) return false
  if (candidate === target) return true
  if (KNOWN_VARIANTS.has(candidate) && target === "jarvis") return true
  if (candidate.length < MIN_FUZZY_LENGTH || target.length < MIN_FUZZY_LENGTH) return false
  return editDistance(candidate, target, MAX_EDIT_DISTANCE) <= MAX_EDIT_DISTANCE
}

/**
 * Look for the wake word in an utterance.
 *
 * The wake word is only accepted near the start of the phrase, so that
 * "tell me about Jarvis" does not wake the assistant up. Everything before
 * the wake word is discarded, and the rest becomes the command.
 */
export function matchWakeWord(utterance: string, wakeWord: string): WakeMatch {
  const text = (utterance ?? "").trim()
  if (!text) return { matched: false, command: "" }

  const wake = normaliseWord(wakeWord)
  if (!wake) return { matched: false, command: text }

  // Work on a whitespace-split copy so the original punctuation survives.
  const words = text.split(/\s+/)
  const limit = Math.min(words.length, WAKE_WORD_WINDOW)

  for (let i = 0; i < limit; i++) {
    const word = words[i]
    if (!isWakeWord(word, wake)) continue

    // Everything before the wake word is discarded, so a filler such as
    // "hey" never reaches the assistant.
    const command = words.slice(i + 1).join(" ").replace(/^[\s,.:;-]+/, "").trim()
    return { matched: true, command, matchedWord: word }
  }

  return { matched: false, command: text }
}

/**
 * Wake word matching for the "open" mode, where the assistant answers every
 * utterance. There is nothing to strip, but the leading fillers are still
 * removed so the reply does not start with "hey".
 */
export function stripFillers(utterance: string): string {
  const words = (utterance ?? "").trim().split(/\s+/)
  let index = 0
  while (index < words.length && LEADING_FILLERS.has(normaliseWord(words[index]))) index++
  return words.slice(index).join(" ").trim()
}
