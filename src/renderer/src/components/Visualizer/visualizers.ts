/**
 * Canvas visualisers.
 *
 * Each mode draws a different picture of the same audio: the live level, the
 * spectrum and the recent waveform. They all read the shared audio engine,
 * so the picture follows whatever JARVIS is doing.
 */

export type VisualizerMode = "orb" | "reactor" | "bars" | "waveform" | "grid"

export interface VisualizerModeInfo {
  id: VisualizerMode
  label: string
  icon: string
}

export const VISUALIZER_MODES: VisualizerModeInfo[] = [
  { id: "orb", label: "Orb", icon: "blur_circular" },
  { id: "reactor", label: "Reactor", icon: "radio_button_checked" },
  { id: "bars", label: "Spectrum", icon: "equalizer" },
  { id: "waveform", label: "Waveform", icon: "graphic_eq" },
  { id: "grid", label: "Grid", icon: "grid_on" }
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
      const wave_ = value * (1 + level)

      const distance = Math.hypot(c - cols / 2, r - rows / 2) / (cols / 2)
      const pulse = Math.sin(time * 2 - distance * 6) * 0.5 + 0.5
      const intensity = Math.min(1, wave_ * 1.6 + pulse * 0.16 * (1 - distance))

      if (intensity < 0.04) continue
      const size = cellW * 0.42 * (0.4 + intensity)
      ctx.fillStyle = withAlpha(intensity > 0.55 ? cyan : accent, 0.15 + intensity * 0.7)
      ctx.fillRect(c * cellW + (cellW - size) / 2, r * cellH + (cellH - size) / 2, size, size)
    }
  }
}
