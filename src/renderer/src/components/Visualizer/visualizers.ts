/**
 * Canvas visualisers.
 *
 * Every preset is built on a different shape, so they read as different
 * instruments rather than variations on a circle:
 *
 *   orb      a drifting particle cloud
 *   core     concentric rings and rotating spokes
 *   spectrum vertical bars
 *   scope    an oscilloscope trace
 *   lattice  a grid of cells that light up
 *   tunnel   a perspective tunnel
 *   star     radial spikes
 *   aurora   flowing horizontal bands
 *   lissajous a parametric curve
 *   rain     falling glyphs
 *   petals   overlapping soft ellipses
 *   peaks    a mirrored mountain
 *   spiral   a spiral of dots
 */

export type VisualizerMode =
  | "orb"
  | "core"
  | "spectrum"
  | "scope"
  | "lattice"
  | "tunnel"
  | "star"
  | "aurora"
  | "lissajous"
  | "rain"
  | "petals"
  | "peaks"
  | "spiral"

export interface VisualizerModeInfo {
  id: VisualizerMode
  label: string
  icon: string
}

export const VISUALIZER_MODES: VisualizerModeInfo[] = [
  { id: "orb", label: "Orb", icon: "blur_circular" },
  { id: "core", label: "Core", icon: "radio_button_checked" },
  { id: "tunnel", label: "Tunnel", icon: "moving" },
  { id: "star", label: "Star", icon: "flare" },
  { id: "petals", label: "Petals", icon: "local_florist" },
  { id: "lissajous", label: "Lissajous", icon: "timeline" },
  { id: "spectrum", label: "Spectrum", icon: "equalizer" },
  { id: "scope", label: "Scope", icon: "graphic_eq" },
  { id: "peaks", label: "Peaks", icon: "bar_chart" },
  { id: "aurora", label: "Aurora", icon: "linear_scale" },
  { id: "lattice", label: "Lattice", icon: "grid_on" },
  { id: "spiral", label: "Spiral", icon: "rotate_right" },
  { id: "rain", label: "Rain", icon: "terminal" }
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

/* ─────────────────────────  Orb  ─────────────────────────
   A drifting cloud of particles around a bright core. */

export function drawOrb(v: VisualContext, particles: OrbParticle[]): void {
  const { ctx, width, height, time, level, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 1.4)
  glow.addColorStop(0, withAlpha(accent, 0.2 + level * 0.28))
  glow.addColorStop(0.55, withAlpha(cyan, 0.06))
  glow.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)

  for (const p of particles) {
    const wobble = Math.sin(time * p.speed + p.offset) * 0.1
    const r = base * (0.2 + p.radius * (0.45 + level * 0.5) + wobble)
    const a = p.angle + time * 0.12 * p.speed
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r * 0.82
    const size = p.size * (1 + level * 2.2)

    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(p.offset % 2 < 1 ? accent : cyan, 0.22 + level * 0.6)
    ctx.fill()
  }

  const coreR = base * (0.09 + level * 0.17)
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
  core.addColorStop(0, withAlpha("#ffffff", 0.9))
  core.addColorStop(0.35, withAlpha(accent, 0.8))
  core.addColorStop(1, withAlpha(cyan, 0))
  ctx.beginPath()
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
  ctx.fillStyle = core
  ctx.fill()
}

/* ─────────────────────────  Core  ─────────────────────────
   Concentric rings with rotating spokes. */

export function drawCore(v: VisualContext): void {
  const { ctx, width, height, time, level, frequency, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  for (let i = 0; i < 5; i++) {
    const r = base * (0.18 + i * 0.16) * (1 + level * 0.3)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = withAlpha(i % 2 ? cyan : accent, 0.2 + level * 0.45)
    ctx.lineWidth = 1.5 + level * 2
    ctx.stroke()
  }

  const spokes = 12
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + time * (0.3 + frequency)
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * base * 0.12, cy + Math.sin(a) * base * 0.12)
    ctx.lineTo(cx + Math.cos(a) * base * (0.28 + level * 0.38), cy + Math.sin(a) * base * (0.28 + level * 0.38))
    ctx.strokeStyle = withAlpha(accent, 0.16 + level * 0.4)
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  ctx.beginPath()
  ctx.arc(cx, cy, base * (0.07 + level * 0.12), 0, Math.PI * 2)
  ctx.fillStyle = withAlpha(accent, 0.6 + level * 0.35)
  ctx.fill()
}

/* ───────────────────────  Tunnel  ───────────────────────
   A perspective tunnel: concentric squares flying towards the viewer. */

export function drawTunnel(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.62

  ctx.clearRect(0, 0, width, height)

  const rings = 14
  for (let i = 0; i < rings; i++) {
    const band = bandAt(freq, i, rings)
    // Each ring is at its own depth, travelling outwards.
    const phase = (time * (0.22 + band * 0.9) + i / rings) % 1
    const depth = 0.08 + phase * 0.92
    const size = base * depth
    const fade = (1 - phase) * (0.16 + level * 0.55)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(time * 0.15 + i * 0.22)
    ctx.strokeStyle = withAlpha(i % 3 === 0 ? cyan : accent, fade)
    ctx.lineWidth = 1 + band * 2.5
    ctx.strokeRect(-size, -size, size * 2, size * 2)
    ctx.restore()
  }
}

/* ─────────────────────────  Star  ─────────────────────────
   Radial spikes from a central line. */

export function drawStar(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  const count = 96
  for (let i = 0; i < count; i++) {
    const value = bandAt(freq, i, count)
    const a = (i / count) * Math.PI * 2
    const inner = base * 0.13
    const outer = inner + base * (0.05 + value * 0.78) * (1 + level * 0.2)

    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer)
    ctx.strokeStyle = withAlpha(value > 0.55 ? cyan : accent, 0.3 + value * 0.65)
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.stroke()
  }

  // A slowly turning cross in the middle.
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(time * 0.4)
  ctx.strokeStyle = withAlpha(accent, 0.3)
  ctx.lineWidth = 1
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(-base * 0.12, 0)
    ctx.lineTo(base * 0.12, 0)
    ctx.stroke()
  }
  ctx.restore()
}

/* ────────────────────────  Petals  ────────────────────────
   Overlapping soft ellipses forming a flower. */

export function drawPetals(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.5

  ctx.clearRect(0, 0, width, height)

  const petals = 9
  for (let i = 0; i < petals; i++) {
    const value = bandAt(freq, i, petals)
    const a = (i / petals) * Math.PI * 2 + time * 0.14
    const reach = base * (0.16 + value * 0.5) * (1 + level * 0.2)
    const thickness = base * (0.09 + value * 0.13)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(a)
    const gradient = ctx.createLinearGradient(0, 0, reach, 0)
    gradient.addColorStop(0, withAlpha(cyan, 0.5))
    gradient.addColorStop(1, withAlpha(accent, 0.04))
    ctx.beginPath()
    ctx.ellipse(reach * 0.55, 0, reach * 0.55, thickness, 0, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.restore()
  }

  ctx.beginPath()
  ctx.arc(cx, cy, base * 0.08 * (1 + level * 0.8), 0, Math.PI * 2)
  ctx.fillStyle = withAlpha("#ffffff", 0.65)
  ctx.fill()
}

/* ───────────────────────  Lissajous  ───────────────────────
   A parametric curve. */

export function drawLissajous(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.42

  ctx.clearRect(0, 0, width, height)

  const low = bandAt(freq, 0, 40)
  const high = bandAt(freq, 20, 40)
  const a = 1 + Math.round(low * 4)
  const b = 2 + Math.round(high * 4)
  const phase = time * (0.4 + level * 1.2)

  ctx.beginPath()
  const steps = 320
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const x = cx + Math.sin(a * t + phase) * base
    const y = cy + Math.sin(b * t) * base
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = withAlpha(accent, 0.75)
  ctx.lineWidth = 1.8
  ctx.stroke()

  // A second curve, mirrored and in the other colour.
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const x = cx + Math.sin(b * t - phase) * base * 0.82
    const y = cy + Math.sin(a * t) * base * 0.82
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = withAlpha(cyan, 0.4)
  ctx.lineWidth = 1.2
  ctx.stroke()
}

/* ───────────────────────  Spectrum  ───────────────────────
   Vertical bars along the bottom. */

export function drawSpectrum(v: VisualContext): void {
  const { ctx, width, height, level, freq, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const count = 42
  const gap = 3
  const barWidth = Math.max(2, (width - gap * (count - 1)) / count)
  const usable = height * 0.78
  const bottom = height * 0.9

  for (let i = 0; i < count; i++) {
    const value = bandAt(freq, i, count)
    const h = Math.max(2, value * usable * (0.65 + level * 0.5))

    const x = i * (barWidth + gap)
    const gradient = ctx.createLinearGradient(0, bottom - h, 0, bottom)
    gradient.addColorStop(0, withAlpha(cyan, 0.95))
    gradient.addColorStop(1, withAlpha(accent, 0.35))
    ctx.fillStyle = gradient
    ctx.fillRect(x, bottom - h, barWidth, h)
  }
}

/* ─────────────────────────  Scope  ─────────────────────────
   An oscilloscope trace with a filled envelope. */

export function drawScope(v: VisualContext): void {
  const { ctx, width, height, time, level, wave, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const mid = height / 2
  const step = width / Math.max(1, wave.length - 1)

  ctx.beginPath()
  ctx.moveTo(0, mid)
  for (let i = 0; i < wave.length; i++) {
    const value = (wave[i] - 128) / 128
    ctx.lineTo(i * step, mid + value * height * 0.4)
  }
  ctx.lineTo(width, mid)
  ctx.closePath()
  ctx.fillStyle = withAlpha(accent, 0.12 + level * 0.2)
  ctx.fill()

  ctx.beginPath()
  for (let i = 0; i < wave.length; i++) {
    const value = (wave[i] - 128) / 128
    const y = mid + value * height * 0.4
    if (i === 0) ctx.moveTo(0, y)
    else ctx.lineTo(i * step, y)
  }
  ctx.strokeStyle = withAlpha(cyan, 0.9)
  ctx.lineWidth = 1.5
  ctx.stroke()

  const sweep = ((time * 0.35) % 1) * width
  const highlight = ctx.createLinearGradient(sweep - 70, 0, sweep + 70, 0)
  highlight.addColorStop(0, "rgba(0,0,0,0)")
  highlight.addColorStop(0.5, withAlpha(accent, 0.3))
  highlight.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = highlight
  ctx.fillRect(0, 0, width, height)
}

/* ─────────────────────────  Peaks  ─────────────────────────
   A mirrored mountain range along the bottom. */

export function drawPeaks(v: VisualContext): void {
  const { ctx, width, height, level, freq, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const count = 56
  const base = height * 0.82
  const points: number[] = []

  for (let i = 0; i < count; i++) {
    const value = bandAt(freq, i, count)
    // A little smoothing, so it looks like a landscape.
    const previous = points[i - 1] ?? value
    points.push(previous * 0.45 + value * 0.55)
  }

  for (const sign of [1, -1]) {
    ctx.beginPath()
    ctx.moveTo(0, base)
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * width
      const y = base - sign * points[i] * height * 0.3 * (0.7 + level * 0.4)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(width, base)
    ctx.closePath()
    ctx.fillStyle = withAlpha(sign > 0 ? accent : cyan, sign > 0 ? 0.3 : 0.14)
    ctx.fill()
  }

  ctx.strokeStyle = withAlpha(accent, 0.6)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * width
    const y = base - points[i] * height * 0.3 * (0.7 + level * 0.4)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

/* ─────────────────────────  Aurora  ─────────────────────────
   Flowing horizontal bands. */

export function drawAurora(v: VisualContext): void {
  const { ctx, width, height, time, level, wave, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const layers = 4
  for (let layer = 0; layer < layers; layer++) {
    const thickness = height * (0.07 + level * 0.05)
    const baseY = height * (0.2 + layer * 0.2)

    ctx.beginPath()
    for (let x = 0; x <= width; x += 4) {
      const t = x / width
      const waveValue = wave[Math.floor(t * (wave.length - 1))] ?? 128
      const y = baseY + ((waveValue - 128) / 128) * height * 0.12 + Math.sin(t * 4 + time + layer) * height * 0.05
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = withAlpha(layer % 2 ? cyan : accent, 0.55 - layer * 0.09)
    ctx.lineWidth = thickness
    ctx.lineCap = "round"
    ctx.stroke()
  }
}

/* ────────────────────────  Lattice  ────────────────────────
   A grid of cells that light up. */

export function drawLattice(v: VisualContext): void {
  const { ctx, width, height, time, level, wave, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const rows = 11
  const cols = 24
  const cellW = width / cols
  const cellH = height / rows

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = Math.floor((c / cols) * (wave.length - 1))
      const value = Math.abs((wave[index] - 128) / 128)
      const distance = Math.hypot(c - cols / 2, r - rows / 2) / (cols / 2)
      const pulse = Math.sin(time * 2 - distance * 6) * 0.5 + 0.5
      const intensity = Math.min(1, value * 1.6 + pulse * 0.16 * (1 - distance))

      if (intensity < 0.04) continue
      const size = cellW * 0.42 * (0.4 + intensity)
      ctx.fillStyle = withAlpha(intensity > 0.55 ? cyan : accent, 0.15 + intensity * 0.7)
      ctx.fillRect(c * cellW + (cellW - size) / 2, r * cellH + (cellH - size) / 2, size, size)
    }
  }
}

/* ─────────────────────────  Spiral  ─────────────────────────
   A spiral of dots that winds in and out. */

export function drawSpiral(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  const cx = width / 2
  const cy = height / 2
  const base = Math.min(width, height) * 0.46

  ctx.clearRect(0, 0, width, height)

  const count = 190
  for (let i = 0; i < count; i++) {
    const t = i / count
    const band = bandAt(freq, Math.floor(t * 40), 40)
    const angle = t * Math.PI * 7 + time * 0.5
    const radius = base * (0.06 + t * 0.94)
    const size = 1 + band * 4 * (1 + level)

    ctx.beginPath()
    ctx.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, size, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(t > 0.6 ? cyan : accent, 0.2 + band * 0.7)
    ctx.fill()
  }
}

/* ──────────────────────────  Rain  ──────────────────────────
   Falling glyphs. */

const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789"

export function drawRain(v: VisualContext): void {
  const { ctx, width, height, time, level, freq, accent, cyan } = v
  ctx.clearRect(0, 0, width, height)

  const columns = Math.max(8, Math.floor(width / 16))
  const rows = Math.max(6, Math.floor(height / 18))
  const columnWidth = width / columns

  ctx.font = "13px monospace"
  ctx.textBaseline = "top"

  for (let c = 0; c < columns; c++) {
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

  const wash = ctx.createLinearGradient(0, height * 0.6, 0, height)
  wash.addColorStop(0, withAlpha(accent, 0))
  wash.addColorStop(1, withAlpha(accent, 0.05 + level * 0.14))
  ctx.fillStyle = wash
  ctx.fillRect(0, height * 0.6, width, height * 0.4)
}
