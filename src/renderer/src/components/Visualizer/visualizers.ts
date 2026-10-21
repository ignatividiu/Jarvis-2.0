/**
 * Canvas visualisers.
 *
 * Each mode draws a different picture of the same audio: the live level, the
 * spectrum and the recent waveform. They all read the shared audio engine,
 * so the picture follows whatever JARVIS is doing.
 */

export type VisualizerMode =
  | "orb"
  | "reactor"
  | "bars"
  | "waveform"
  | "grid"
  | "pulse"
  | "radial"
  | "ribbon"
  | "helix"
  | "matrix"
  | "bloom"

export interface VisualizerModeInfo {
  id: VisualizerMode
  label: string
  icon: string
}

export const VISUALIZER_MODES: VisualizerModeInfo[] = [
  { id: "orb", label: "Orb", icon: "blur_circular" },
  { id: "reactor", label: "Reactor", icon: "radio_button_checked" },
  { id: "pulse", label: "Pulse", icon: "waves" },
  { id: "radial", label: "Radial", icon: "donut_large" },
  { id: "bloom", label: "Bloom", icon: "local_florist" },
  { id: "helix", label: "Helix", icon: "sync" },
  { id: "ribbon", label: "Ribbon", icon: "linear_scale" },
  { id: "bars", label: "Spectrum", icon: "equalizer" },
  { id: "waveform", label: "Waveform", icon: "graphic_eq" },
  { id: "grid", label: "Grid", icon: "grid_on" },
  { id: "matrix", label: "Matrix", icon: "terminal" }
]

export interface VisualContext {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  time: number
  level: number
  peak: number
  frequency: number
  freq: Uint8Array
  wave: Uint8Array
  speaking: boolean
  listening: boolean
  accent: string
  cyan: string
}

export interface OrbParticle {
  angle: number
  radius: number
  speed: number
  size: number
  offset: number
}

/** A ring of particles that breathe with the audio. */
export function createOrbParticles(count: number): OrbParticle[] {
  return Array.from({ length: count }, (_, i) => ({
    angle: (i / count) * Math.PI * 2,
    radius: 0.35 + Math.random() * 0.5,
    speed: 0.2 + Math.random() * 0.6,
    size: 0.6 + Math.random() * 1.8,
    offset: Math.random() * Math.PI * 2
  }))
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "")
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** A value from the spectrum, chosen logarithmically so the low end is not squashed. */
function bandAt(freq: Uint8Array, index: number, count: number): number {
  if (!freq.length) return 0
  const position = Math.pow(index / Math.max(1, count), 1.6) * (freq.length - 1)
  return (freq[Math.floor(position)] ?? 0) / 255
}

/* ─────────────────────────────  Orb  ───────────────────────────── */

export function drawOrb(v: VisualContext, particles: OrbParticle[]): void {
  const { ctx, width, height, time, level, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  // The glow behind the core.
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 1.5)
  glow.addColorStop(0, withAlpha(accent, 0.22 + level * 0.3))
  glow.addColorStop(0.5, withAlpha(cyan, 0.07))
  glow.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)

  // The particles.
  for (const p of particles) {
    const wobble = Math.sin(time * p.speed + p.offset) * 0.08
    const r = base * (0.22 + p.radius * (0.5 + level * 0.55) + wobble)
    const a = p.angle + time * 0.12 * p.speed
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r * 0.86
    const size = p.size * (1 + level * 2.4)

    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(p.offset % 2 < 1 ? accent : cyan, 0.25 + level * 0.6)
    ctx.fill()
  }

  // The core.
  const coreR = base * (0.1 + level * 0.2)
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
  core.addColorStop(0, withAlpha("#ffffff", 0.9))
  core.addColorStop(0.35, withAlpha(accent, 0.85))
  core.addColorStop(1, withAlpha(cyan, 0))
  ctx.beginPath()
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
  ctx.fillStyle = core
  ctx.fill()
}

/* ───────────────────────────  Reactor  ─────────────────────────── */

export function drawReactor(v: VisualContext): void {
  const { ctx, width, height, time, level, frequency, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  // Concentric rings that pulse with the level.
  for (let i = 0; i < 5; i++) {
    const r = base * (0.2 + i * 0.16) * (1 + level * 0.35)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = withAlpha(i % 2 ? cyan : accent, 0.22 + level * 0.5)
    ctx.lineWidth = 1.5 + level * 2
    ctx.stroke()
  }

  // The rotating spokes.
  const spokes = 12
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + time * (0.3 + frequency)
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * base * 0.14, cy + Math.sin(a) * base * 0.14)
    ctx.lineTo(cx + Math.cos(a) * base * (0.3 + level * 0.4), cy + Math.sin(a) * base * (0.3 + level * 0.4))
    ctx.strokeStyle = withAlpha(accent, 0.18 + level * 0.45)
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  // The centre.
  ctx.beginPath()
  ctx.arc(cx, cy, base * (0.08 + level * 0.14), 0, Math.PI * 2)
  ctx.fillStyle = withAlpha(accent, 0.65 + level * 0.35)
  ctx.fill()
}

/* ────────────────────────────  Pulse  ──────────────────────────── */

export function drawPulse(v: VisualContext): void {
  const { ctx, width, height, time, level, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  // Rings that travel outwards, driven by the level.
  const rings = 6
  for (let i = 0; i < rings; i++) {
    const phase = (time * 0.45 + i / rings) % 1
    const r = base * (0.12 + phase * 0.85) * (1 + level * 0.25)
    const fade = (1 - phase) * (0.25 + level * 0.6)

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = withAlpha(i % 2 ? cyan : accent, fade)
    ctx.lineWidth = 2.5 * (1 - phase) + 0.5
    ctx.stroke()
  }

  // A solid heart that beats with the level.
  const beat = 1 + level * 0.5
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.3 * beat)
  gradient.addColorStop(0, withAlpha("#ffffff", 0.85))
  gradient.addColorStop(0.4, withAlpha(accent, 0.8))
  gradient.addColorStop(1, withAlpha(cyan, 0))
  ctx.beginPath()
  ctx.arc(cx, cy, base * 0.3 * beat, 0, Math.PI * 2)
  ctx.fillStyle = gradient
  ctx.fill()
}

/* ───────────────────────────  Radial  ─────────────────────────── */

export function drawRadial(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  const count = 72
  const inner = base * 0.28
  for (let i = 0; i < count; i++) {
    const value = bandAt(freq, i, count)
    const a = (i / count) * Math.PI * 2 - Math.PI / 2 + time * 0.12
    const length = base * (0.06 + value * 0.55) * (1 + level * 0.3)

    const x1 = cx + Math.cos(a) * inner
    const y1 = cy + Math.sin(a) * inner
    const x2 = cx + Math.cos(a) * (inner + length)
    const y2 = cy + Math.sin(a) * (inner + length)

    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = withAlpha(i % 3 === 0 ? cyan : accent, 0.25 + value * 0.7)
    ctx.lineWidth = 3
    ctx.lineCap = "round"
    ctx.stroke()
  }

  // The hub.
  ctx.beginPath()
  ctx.arc(cx, cy, inner * 0.85, 0, Math.PI * 2)
  ctx.fillStyle = withAlpha(accent, 0.12 + level * 0.2)
  ctx.fill()
}

/* ───────────────────────────  Bloom  ─────────────────────────── */

export function drawBloom(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  const petals = 10
  for (let i = 0; i < petals; i++) {
    const value = bandAt(freq, i, petals)
    const a = (i / petals) * Math.PI * 2 + time * 0.18
    const reach = base * (0.18 + value * 0.62) * (1 + level * 0.25)
    const width2 = base * (0.1 + value * 0.16)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(a)
    const gradient = ctx.createLinearGradient(0, 0, reach, 0)
    gradient.addColorStop(0, withAlpha(cyan, 0.55))
    gradient.addColorStop(1, withAlpha(accent, 0.05))
    ctx.beginPath()
    ctx.ellipse(reach * 0.5, 0, reach * 0.5, width2, 0, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.restore()
  }

  ctx.beginPath()
  ctx.arc(cx, cy, base * 0.09 * (1 + level * 0.7), 0, Math.PI * 2)
  ctx.fillStyle = withAlpha("#ffffff", 0.7)
  ctx.fill()
}

/* ───────────────────────────  Helix  ─────────────────────────── */

export function drawHelix(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  const cx = width / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  const steps = 90
  const points: Array<[number, number, number]> = []

  for (let i = 0; i < steps; i++) {
    const t = i / steps
    const y = t * height
    const band = bandAt(freq, Math.floor(t * 40), 40)
    const twist = time * 1.1 + t * Math.PI * 3.2
    const spread = base * (0.16 + band * 0.42) * (1 + level * 0.2)

    points.push([cx + Math.cos(twist) * spread, y, band])
    points.push([cx - Math.cos(twist) * spread, y, band])
  }

  // The two strands.
  for (const strand of [0, 1]) {
    ctx.beginPath()
    for (let i = 0; i < steps; i++) {
      const p = points[strand === 0 ? i * 2 : i * 2 + 1]
      if (!p) continue
      if (i === 0) ctx.moveTo(p[0], p[1])
      else ctx.lineTo(p[0], p[1])
    }
    ctx.strokeStyle = withAlpha(strand === 0 ? accent : cyan, 0.65)
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // The rungs between them.
  for (let i = 0; i < steps; i += 3) {
    const a = points[i * 2]
    const b = points[i * 2 + 1]
    if (!a || !b) continue
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.strokeStyle = withAlpha(accent, 0.06 + a[2] * 0.3)
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

/* ───────────────────────────  Ribbon  ─────────────────────────── */

export function drawRibbon(v: VisualContext): void {
  const { ctx, width, height, time, level, wave, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const layers = 5
  for (let layer = 0; layer < layers; layer++) {
    const offset = layer / layers
    ctx.beginPath()
    for (let i = 0; i < wave.length; i++) {
      const x = (i / (wave.length - 1)) * width
      const value = (wave[i] - 128) / 128
      const y =
        height / 2 +
        value * height * (0.14 + level * 0.22) * (1 - offset * 0.5) +
        Math.sin(time * 1.2 + i * 0.02 + offset * 3) * height * 0.04 * (1 + level)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = withAlpha(layer % 2 ? cyan : accent, 0.5 - offset * 0.28)
    ctx.lineWidth = 2.5 - offset * 1.4
    ctx.stroke()
  }
}

/* ────────────────────────────  Bars  ──────────────────────────── */

export function drawBars(v: VisualContext): void {
  const { ctx, width, height, level, freq, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const count = 42
  const gap = 3
  const barWidth = Math.max(2, (width - gap * (count - 1)) / count)
  const usable = height * 0.82
  const bottom = height * 0.9

  for (let i = 0; i < count; i++) {
    // A logarithmic spread, so the low end is not squashed.
    const index = Math.floor(Math.pow(i / count, 1.6) * (freq.length - 1))
    const value = (freq[index] ?? 0) / 255
    const h = Math.max(2, value * usable * (0.65 + level * 0.5))

    const x = i * (barWidth + gap)
    const gradient = ctx.createLinearGradient(0, bottom - h, 0, bottom)
    gradient.addColorStop(0, withAlpha(cyan, 0.95))
    gradient.addColorStop(1, withAlpha(accent, 0.35))
    ctx.fillStyle = gradient
    ctx.fillRect(x, bottom - h, barWidth, h)
  }
}

/* ───────────────────────────  Waveform  ─────────────────────────── */

export function drawWaveform(v: VisualContext): void {
  const { ctx, width, height, time, level, wave, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const mid = height / 2
  const step = width / Math.max(1, wave.length - 1)

  // The filled envelope.
  ctx.beginPath()
  ctx.moveTo(0, mid)
  for (let i = 0; i < wave.length; i++) {
    const v2 = (wave[i] - 128) / 128
    ctx.lineTo(i * step, mid + v2 * height * 0.42)
  }
  ctx.lineTo(width, mid)
  ctx.closePath()
  ctx.fillStyle = withAlpha(accent, 0.12 + level * 0.2)
  ctx.fill()

  // The line itself.
  ctx.beginPath()
  for (let i = 0; i < wave.length; i++) {
    const v2 = (wave[i] - 128) / 128
    const y = mid + v2 * height * 0.42
    if (i === 0) ctx.moveTo(0, y)
    else ctx.lineTo(i * step, y)
  }
  ctx.strokeStyle = withAlpha(cyan, 0.85)
  ctx.lineWidth = 1.4
  ctx.stroke()

  // A sweeping highlight.
  const sweep = ((time * 0.35) % 1) * width
  const highlight = ctx.createLinearGradient(sweep - 60, 0, sweep + 60, 0)
  highlight.addColorStop(0, "rgba(0,0,0,0)")
  highlight.addColorStop(0.5, withAlpha(accent, 0.35))
  highlight.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = highlight
  ctx.fillRect(0, 0, width, height)
}

/* ────────────────────────────  Grid  ──────────────────────────── */

export function drawGrid(v: VisualContext): void {
  const { ctx, width, height, time, level, wave, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const rows = 12
  const cols = 26
  const cellW = width / cols
  const cellH = height / rows

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = Math.floor((c / cols) * (wave.length - 1))
      const value = Math.abs((wave[index] - 128) / 128)
      const waveValue = value * (1 + level)

      const distance = Math.hypot(c - cols / 2, r - rows / 2) / (cols / 2)
      const pulse = Math.sin(time * 2 - distance * 6) * 0.5 + 0.5
      const intensity = Math.min(1, waveValue * 1.6 + pulse * 0.16 * (1 - distance))

      if (intensity < 0.04) continue
      const size = cellW * 0.42 * (0.4 + intensity)
      ctx.fillStyle = withAlpha(intensity > 0.55 ? cyan : accent, 0.15 + intensity * 0.7)
      ctx.fillRect(c * cellW + (cellW - size) / 2, r * cellH + (cellH - size) / 2, size, size)
    }
  }
}

/* ───────────────────────────  Matrix  ─────────────────────────── */

const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789"

export function drawMatrix(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const columns = Math.max(8, Math.floor(width / 16))
  const rows = Math.max(6, Math.floor(height / 18))
  const columnWidth = width / columns

  ctx.font = "13px monospace"
  ctx.textBaseline = "top"

  for (let c = 0; c < columns; c++) {
    // Each column falls at its own speed and lights up with its own band.
    const band = bandAt(freq, c, columns)
    const speed = 0.25 + band * 2.4
    const offset = (time * speed + c * 7) % (rows + 6)

    for (let r = 0; r < rows; r++) {
      const distance = offset - r
      if (distance < 0 || distance > 5) continue

      const fade = 1 - distance / 5
      const glyph = GLYPHS[(r * 7 + c * 13 + Math.floor(time * 3 + c)) % GLYPHS.length]

      ctx.fillStyle = distance < 1.5 ? withAlpha("#ffffff", fade) : withAlpha(c % 3 === 0 ? cyan : accent, fade * 0.75)
      ctx.fillText(glyph, c * columnWidth + columnWidth * 0.3, r * 18)
    }
  }

  // A wash of colour at the bottom, driven by the level.
  const wash = ctx.createLinearGradient(0, height * 0.6, 0, height)
  wash.addColorStop(0, withAlpha(accent, 0))
  wash.addColorStop(1, withAlpha(accent, 0.05 + level * 0.14))
  ctx.fillStyle = wash
  ctx.fillRect(0, height * 0.6, width, height * 0.4)
}
