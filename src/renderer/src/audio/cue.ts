/**
 * The confirmation tone.
 *
 * When JARVIS hears its name it plays a short, quiet two-note chime, so the
 * user knows the wake word was picked up before they say the rest of their
 * sentence. Without it there is no feedback that the assistant is listening,
 * which is why the trigger seemed unreliable.
 */

let ctx: AudioContext | null = null

function context(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctor()
  }
  return ctx
}

/**
 * Play the wake chime.
 *
 * Two short notes, rising, with a soft envelope so it never clicks. The
 * call is safe to make without a user gesture: the context is resumed, and
 * a failure is ignored rather than reported.
 */
export async function playWakeCue(volume = 0.35): Promise<void> {
  try {
    const audio = context()
    if (audio.state !== "running") await audio.resume().catch(() => undefined)
    if (audio.state !== "running") return

    const now = audio.currentTime
    const notes: Array<[number, number, number]> = [
      // [frequency, start offset, length]
      [784, 0, 0.09], // G5
      [1175, 0.075, 0.13] // D6
    ]

    const gain = audio.createGain()
    gain.gain.value = Math.max(0, Math.min(1, volume))
    gain.connect(audio.destination)

    for (const [frequency, offset, length] of notes) {
      const oscillator = audio.createOscillator()
      const envelope = audio.createGain()

      oscillator.type = "sine"
      oscillator.frequency.value = frequency

      // A soft attack and release, so the note never clicks.
      envelope.gain.setValueAtTime(0, now + offset)
      envelope.gain.linearRampToValueAtTime(1, now + offset + 0.012)
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + offset + length)

      oscillator.connect(envelope)
      envelope.connect(gain)
      oscillator.start(now + offset)
      oscillator.stop(now + offset + length + 0.02)
    }

    // Release the gain node once the chime has finished.
    setTimeout(() => {
      try {
        gain.disconnect()
      } catch {
        /* ignore */
      }
    }, 600)
  } catch {
    /* the cue is a nicety — never let it break the assistant */
  }
}

/** A short, lower sound for "I did not catch that". */
export async function playMissCue(volume = 0.22): Promise<void> {
  try {
    const audio = context()
    if (audio.state !== "running") await audio.resume().catch(() => undefined)
    if (audio.state !== "running") return

    const now = audio.currentTime
    const oscillator = audio.createOscillator()
    const envelope = audio.createGain()
    const gain = audio.createGain()

    oscillator.type = "triangle"
    oscillator.frequency.setValueAtTime(392, now)
    oscillator.frequency.exponentialRampToValueAtTime(294, now + 0.14)

    envelope.gain.setValueAtTime(0, now)
    envelope.gain.linearRampToValueAtTime(1, now + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)

    oscillator.connect(envelope)
    envelope.connect(gain)
    gain.gain.value = Math.max(0, Math.min(1, volume))
    gain.connect(audio.destination)

    oscillator.start(now)
    oscillator.stop(now + 0.2)

    setTimeout(() => {
      try {
        gain.disconnect()
      } catch {
        /* ignore */
      }
    }, 400)
  } catch {
    /* ignore */
  }
}
