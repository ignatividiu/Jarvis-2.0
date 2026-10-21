/**
 * Trigger phrase detection.
 *
 * The assistant hears an utterance, the local recogniser turns it into text,
 * and this module decides whether the utterance was addressed to JARVIS.
 *
 * The trigger is a *phrase* — the default is "Hey jarvis". The rule is
 * deliberately forgiving about the words in front of the name and strict
 * about where the name sits:
 *
 *  - The name may appear anywhere in the opening words, but everything
 *    before it has to be a filler ("hey", "ok", "please", "so", …).
 *    That way "a jarvis, open the door" and "ok so jarvis" both work, while
 *    "tell me about jarvis" does not.
 *  - The name itself is matched loosely, because speech recognisers rarely
 *    spell it the way it is written: "jarvus", "jervis" and "harvis" all
 *    count.
 */

/** Minimum word length before fuzzy matching is allowed. */
const MIN_FUZZY_LENGTH = 4

/** Maximum edit distance that still counts as the name. */
const MAX_EDIT_DISTANCE = 2

/**
 * How many words from the start the name may appear in.
 */
const TRIGGER_WINDOW = 4

/**
 * Words that may come before the name.
 *
 * The list is deliberately generous — these are the sounds people put in
 * front of a name when they are addressing a machine.
 */
const LEADING_FILLERS = new Set([
  "hey",
  "hi",
  "hello",
  "ok",
  "okay",
  "yo",
  "computer",
  "assistant",
  "please",
  "now",
  "well",
  "so",
  "right",
  "um",
  "uh",
  "hmm",
  "ah",
  "oh",
  "there",
  "a",
  "an",
  "just",
  "morning",
  "evening"
])

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

/** Is this word a filler that may come before the name? */
export function isFiller(word: string): boolean {
  return LEADING_FILLERS.has(normaliseWord(word))
}

/**
 * Look for the trigger phrase in an utterance.
 *
 * The last word of the phrase is the name; the words before it are a prefix.
 * The name is matched loosely and must be in the opening words, with only
 * fillers in front of it.
 */
export function matchWakeWord(utterance: string, wakeWord: string): WakeMatch {
  const text = (utterance ?? "").trim()
  if (!text) return { matched: false, command: "" }

  const trigger = parseTrigger(wakeWord)
  if (!trigger.length) return { matched: false, command: text }

  const name = trigger[trigger.length - 1]
  const words = text.split(/\s+/)
  const limit = Math.min(words.length, TRIGGER_WINDOW)

  for (let i = 0; i < limit; i++) {
    if (!isWakeWord(words[i], name)) continue

    // Everything in front of the name has to be a filler, or the name is
    // part of a sentence rather than an address.
    let onlyFillers = true
    for (let k = 0; k < i; k++) {
      if (!isFiller(words[k])) {
        onlyFillers = false
        break
      }
    }
    if (!onlyFillers) continue

    // The command is everything after the name.
    const command = words
      .slice(i + 1)
      .join(" ")
      .replace(/^[\s,.:;-]+/, "")
      .trim()
    return { matched: true, command, matchedWords: words.slice(i, i + 1) }
  }

  return { matched: false, command: text }
}

/**
 * Trigger matching for the "open" mode, where the assistant answers every
 * utterance. There is nothing to strip, but the leading fillers are still
 * removed so the reply does not start with "hey".
 */
export function stripFillers(utterance: string): string {
  const words = (utterance ?? "").trim().split(/\s+/)
  let index = 0
  while (index < words.length && isFiller(words[index])) index++
  return words.slice(index).join(" ").trim()
}
