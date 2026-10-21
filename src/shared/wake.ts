/**
 * Wake word detection.
 *
 * The assistant hears an utterance, the local recogniser turns it into text,
 * and this module decides whether the utterance was addressed to JARVIS.
 *
 * The trigger is a *phrase*, not a single word — the default is "Hey
 * jarvis". Speech recognisers rarely spell a name exactly the way it is
 * written, so the matcher accepts near-misses: "jarvis", "jarvus",
 * "jervis", "jarvez" and friends all count. A Levenshtein distance keeps
 * the rule general without needing a dictionary of every accent and
 * mis-hearing.
 */

/** Minimum word length before fuzzy matching is allowed. */
const MIN_FUZZY_LENGTH = 4

/** Maximum edit distance that still counts as the wake word. */
const MAX_EDIT_DISTANCE = 2

/**
 * How many words from the start may contain the trigger.
 *
 * The name has to be near the beginning, so that "tell me about Jarvis"
 * does not wake the assistant up.
 */
const WAKE_WORD_WINDOW = 4

/**
 * Fillers that may sit in front of the trigger.
 *
 * A phrase such as "hey jarvis" is matched with or without its leading
 * filler, so "jarvis, open the door" works just as well.
 */
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
  /** True when the trigger was found. */
  matched: boolean
  /** The utterance with the trigger (and its fillers) removed. */
  command: string
  /** The words that actually matched. */
  matchedWords?: string[]
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

/** Split a trigger phrase into its words. */
export function parseTrigger(phrase: string): string[] {
  return (phrase ?? "")
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9'’-]/gi, ""))
    .filter(Boolean)
}

/**
 * Does this word match this part of the trigger?
 *
 * The last word of a trigger is matched loosely, because that is the name
 * that gets mis-heard. The words in front of it are matched exactly, so
 * "hey" does not fire on "hockey".
 */
function wordMatches(candidate: string, target: string, loose: boolean): boolean {
  if (candidate === target) return true
  if (!loose) return false
  return isWakeWord(candidate, target)
}

/**
 * Look for the trigger phrase in an utterance.
 *
 * The phrase has to appear near the start, and everything before it is
 * discarded. A leading filler — "hey" in "hey jarvis" — is optional, so
 * "Jarvis, what time is it" also wakes the assistant.
 */
export function matchWakeWord(utterance: string, wakeWord: string): WakeMatch {
  const text = (utterance ?? "").trim()
  if (!text) return { matched: false, command: "" }

  const trigger = parseTrigger(wakeWord)
  if (!trigger.length) return { matched: false, command: text }

  const words = text.split(/\s+/)
  const limit = Math.min(words.length, WAKE_WORD_WINDOW + trigger.length)

  // The phrase may be spoken with or without its leading filler.
  const variants: string[][] = [trigger]
  if (trigger.length > 1 && LEADING_FILLERS.has(normaliseWord(trigger[0]))) {
    variants.push(trigger.slice(1))
  }

  for (const variant of variants) {
    // The shortened variant drops the leading filler, so it may only match
    // where a filler would have been — otherwise "tell me about jarvis"
    // would wake the assistant up.
    const shortened = variant.length < trigger.length

    for (let start = 0; start + variant.length <= limit; start++) {
      if (shortened) {
        let onlyFillers = true
        for (let k = 0; k < start; k++) {
          if (!LEADING_FILLERS.has(normaliseWord(words[k]))) {
            onlyFillers = false
            break
          }
        }
        if (!onlyFillers) continue
      }

      let ok = true
      for (let k = 0; k < variant.length; k++) {
        const loose = k === variant.length - 1
        if (!wordMatches(normaliseWord(words[start + k]), normaliseWord(variant[k]), loose)) {
          ok = false
          break
        }
      }
      if (!ok) continue

      // Everything after the trigger is the command.
      const command = words
        .slice(start + variant.length)
        .join(" ")
        .replace(/^[\s,.:;-]+/, "")
        .trim()
      return { matched: true, command, matchedWords: words.slice(start, start + variant.length) }
    }
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
