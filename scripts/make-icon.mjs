#!/usr/bin/env node
/**
 * Generates the application icon.
 *
 * The icon is drawn from scratch — a dark disc with a glowing arc-reactor
 * ring — and written as a PNG without any image library, so the project has
 * no build-time dependency on one.
 */
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const buildDir = join(root, "build")

/* ──────────────────────────  PNG encoding  ────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** Encode RGBA pixels as a PNG. */
function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1)
    raw[start] = 0
    pixels.copy(raw, start + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ])
}

/* ──────────────────────────  The artwork  ────────────────────────── */

const BG = [5, 7, 13]
const GREEN = [61, 220, 151]
const CYAN = [79, 214, 255]

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ]
}

/** Draw the icon into an RGBA buffer. */
function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const c = size / 2
  const radius = size * 0.46

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c + 0.5
      const dy = y - c + 0.5
      const d = Math.sqrt(dx * dx + dy * dy)

      let colour = BG
      let alpha = 0

      // The disc.
      if (d < radius) {
        alpha = 255
        // A soft radial gradient towards the centre.
        const glow = Math.max(0, 1 - d / radius)
        colour = mix(BG, [10, 22, 32], glow * 0.8)
      }

      // The outer ring.
      const ringOuter = radius * 0.88
      const ringInner = radius * 0.8
      if (d <= ringOuter && d >= ringInner) {
        const t = 1 - Math.abs(d - (ringOuter + ringInner) / 2) / ((ringOuter - ringInner) / 2)
        colour = mix(GREEN, CYAN, (x + y) / (size * 2))
        alpha = Math.round(160 + 95 * t)
      }

      // The inner ring.
      const innerOuter = radius * 0.52
      const innerInner = radius * 0.46
      if (d <= innerOuter && d >= innerInner) {
        colour = mix(CYAN, GREEN, (x - y) / size + 0.5)
        alpha = 200
      }

      // The core.
      const core = radius * 0.3
      if (d < core) {
        const t = 1 - d / core
        colour = mix(GREEN, [255, 255, 255], t * 0.75)
        alpha = 255
      }

      // The three "arcs" of the reactor.
      const angle = Math.atan2(dy, dx)
      const arcBand = Math.abs(d - radius * 0.68) < size * 0.018
      if (arcBand && d < radius * 0.78) {
        const segment = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 6) % 6
        if (segment !== 0 && segment !== 3) {
          colour = mix(GREEN, CYAN, 0.5)
          alpha = 220
        }
      }

      const index = (y * size + x) * 4
      pixels[index] = colour[0]
      pixels[index + 1] = colour[1]
      pixels[index + 2] = colour[2]
      pixels[index + 3] = alpha
    }
  }

  return pixels
}

function writeIcon(name, size) {
  const png = encodePng(size, size, drawIcon(size))
  const target = join(buildDir, name)
  writeFileSync(target, png)
  console.log(`  ✓ ${name} (${size}x${size}, ${(png.length / 1024).toFixed(1)} kB)`)
}

function main() {
  mkdirSync(buildDir, { recursive: true })
  console.log("Generating the application icon…")
  writeIcon("icon.png", 512)
  writeIcon("icon-256.png", 256)
  if (!existsSync(join(buildDir, "entitlements.mac.plist"))) {
    console.log("  ! build/entitlements.mac.plist is missing")
  }
}

main()
