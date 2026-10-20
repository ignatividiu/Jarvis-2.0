import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { VoiceOption } from "@shared/types"
import { createLogger } from "../logger"
import { downloadFile } from "../net"

const log = createLogger("voice:piper")

/**
 * Piper — a fully offline neural text-to-speech engine.
 *
 * It is the fallback when the machine has no internet connection, and it is
 * the only engine that works completely offline. The runtime is a small
 * native binary that JARVIS downloads and unpacks on demand; the voices are
 * ONNX models from the `rhasspy/piper-voices` collection.
 */

const PIPER_RELEASE_TAG = "2023.11.14-2"
const VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

/** The archive that holds the runtime for the current platform. */
function archiveForPlatform(): { name: string; url: string } | null {
  const arch = process.arch
  if (process.platform === "win32") {
    if (arch !== "x64") return null
    return {
      name: "piper_windows_amd64.zip",
      url: `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE_TAG}/piper_windows_amd64.zip`
    }
  }
  if (process.platform === "darwin") {
    const suffix = arch === "arm64" ? "aarch64" : "x64"
    return {
      name: `piper_macos_${suffix}.tar.gz`,
      url: `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE_TAG}/piper_macos_${suffix}.tar.gz`
    }
  }
  if (arch === "x64") {
    return {
      name: "piper_linux_x86_64.tar.gz",
      url: `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE_TAG}/piper_linux_x86_64.tar.gz`
    }
  }
  if (arch === "arm64") {
    return {
      name: "piper_linux_aarch64.tar.gz",
      url: `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE_TAG}/piper_linux_aarch64.tar.gz`
    }
  }
  return null
}

export interface PiperVoice {
  id: string
  name: string
  language: string
  gender: "male" | "female" | "neutral"
  /** Download size of the ONNX model. */
  sizeBytes: number
  /** True when the voice reads like a composed British butler. */
  jarvisLike?: boolean
}

/** The voices JARVIS offers. Every one of them is free and offline. */
export const PIPER_VOICES: PiperVoice[] = [
  {
    id: "en_GB-alan-medium",
    name: "Alan (British)",
    language: "en-GB",
    gender: "male",
    sizeBytes: 63_201_294,
    jarvisLike: true
  },
  {
    id: "en_GB-alan-high",
    name: "Alan (British, high fidelity)",
    language: "en-GB",
    gender: "male",
    sizeBytes: 114_000_000,
    jarvisLike: true
  },
  {
    id: "en_GB-northern_english_male-medium",
    name: "Northern English Male",
    language: "en-GB",
    gender: "male",
    sizeBytes: 63_000_000
  },
  {
    id: "en_GB-jenny_dioco-medium",
    name: "Jenny (British)",
    language: "en-GB",
    gender: "female",
    sizeBytes: 63_000_000
  },
  {
    id: "en_GB-cori-high",
    name: "Cori (British, high fidelity)",
    language: "en-GB",
    gender: "female",
    sizeBytes: 114_000_000
  },
  {
    id: "en_GB-southern_english_female-medium",
    name: "Southern English Female",
    language: "en-GB",
    gender: "female",
    sizeBytes: 63_000_000
  },
  {
    id: "en_US-ryan-high",
    name: "Ryan (American)",
    language: "en-US",
    gender: "male",
    sizeBytes: 114_000_000
  },
  {
    id: "en_US-ryan-medium",
    name: "Ryan (American, fast)",
    language: "en-US",
    gender: "male",
    sizeBytes: 63_000_000
  },
  {
    id: "en_US-joe-medium",
    name: "Joe (American)",
    language: "en-US",
    gender: "male",
    sizeBytes: 63_000_000
  },
  {
    id: "en_US-lessac-medium",
    name: "Lessac (American)",
    language: "en-US",
    gender: "female",
    sizeBytes: 63_000_000
  },
  {
    id: "en_US-amy-medium",
    name: "Amy (American)",
    language: "en-US",
    gender: "female",
    sizeBytes: 63_000_000
  },
  {
    id: "en_US-libritts_r-medium",
    name: "LibriTTS (American)",
    language: "en-US",
    gender: "male",
    sizeBytes: 63_000_000
  }
]

/* ───────────────────────────  Paths  ─────────────────────────── */

/** Where the runtime and the voices live. Set by the app on start-up. */
let root = ""
let voicesDir = ""

export function configurePiper(baseDir: string): void {
  root = join(baseDir, "piper")
  voicesDir = join(baseDir, "piper-voices")
}

function binaryPath(): string {
  const exe = process.platform === "win32" ? "piper.exe" : "piper"
  return join(root, "piper", exe)
}

function voicePath(voiceId: string): string {
  return join(voicesDir, `${voiceId}.onnx`)
}

export function isBinaryPresent(): boolean {
  return Boolean(root) && existsSync(binaryPath())
}

export function isVoiceInstalled(voiceId: string): boolean {
  return Boolean(voicesDir) && existsSync(voicePath(voiceId))
}

/** Voices that are already on disk. */
export function installedVoiceIds(): string[] {
  if (!voicesDir || !existsSync(voicesDir)) return []
  try {
    return readdirSync(voicesDir)
      .filter((f) => f.endsWith(".onnx"))
      .map((f) => f.replace(/\.onnx$/, ""))
  } catch {
    return []
  }
}

/* ───────────────────────────  Download  ─────────────────────────── */

/** Split `en_GB-alan-medium` into the folder path Piper uses on Hugging Face. */
export function voiceRepoPath(voiceId: string): string {
  const parts = voiceId.split("-")
  if (parts.length < 3) return `en/${voiceId}`
  const quality = parts[parts.length - 1]
  const locale = parts[0]
  const name = parts.slice(1, -1).join("-")
  const family = locale.split("_")[0]
  return `${family}/${locale}/${name}/${quality}`
}

export function voiceDownloadUrl(voiceId: string): string {
  return `${VOICE_BASE}/${voiceRepoPath(voiceId)}/${voiceId}.onnx`
}

export function voiceConfigUrl(voiceId: string): string {
  return `${voiceRepoPath(voiceId)}/${voiceId}.onnx.json`
}

/**
 * Unpack an archive with the system `tar`.
 *
 * Windows 10 ships bsdtar, which reads both zip and tar.gz; macOS and Linux
 * always have GNU tar, which reads tar.gz. That covers every platform
 * without pulling in a decompression dependency.
 */
async function extractArchive(archive: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xf", archive, "-C", destination], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    })
    let stderr = ""
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString()
    })
    child.on("error", (err) => reject(new Error(`Could not run tar: ${err.message}`)))
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar exited with ${code}: ${stderr.slice(0, 300)}`))
    })
  })
}

/**
 * Download the Piper runtime and (optionally) a voice.
 *
 * Both steps report progress so the setup wizard can show a progress bar.
 */
export async function installPiper(
  voiceId: string,
  onProgress?: (percent: number, message: string, bytes?: { total: number; received: number }) => void
): Promise<{ ok: boolean; message: string }> {
  if (!root) return { ok: false, message: "The voice engine has not been initialised yet." }

  try {
    mkdirSync(root, { recursive: true })
    mkdirSync(voicesDir, { recursive: true })

    if (!isBinaryPresent()) {
      const archive = archiveForPlatform()
      if (!archive) {
        return {
          ok: false,
          message: `Piper does not ship a build for ${process.platform} ${process.arch}. Use the online voice engine instead.`
        }
      }

      const target = join(root, archive.name)
      onProgress?.(0, `Downloading the offline voice engine (${archive.name})…`)
      await downloadFile(archive.url, target, (p) => {
        onProgress?.(
          Math.min(60, Math.round((p.percent * 60) / 100)),
          `Downloading the offline voice engine — ${p.percent}%`,
          { total: p.total, received: p.received }
        )
      })

      onProgress?.(62, "Unpacking the offline voice engine…")
      await extractArchive(target, root)
      rmSync(target, { force: true })

      if (!isBinaryPresent()) {
        return { ok: false, message: "The voice engine was unpacked but the binary is missing." }
      }
    } else {
      onProgress?.(60, "The offline voice engine is already installed.")
    }

    // The voice model itself.
    if (!isVoiceInstalled(voiceId)) {
      const url = voiceDownloadUrl(voiceId)
      onProgress?.(64, "Downloading the voice model…")
      await downloadFile(url, voicePath(voiceId), (p) => {
        onProgress?.(
          64 + Math.round((p.percent * 34) / 100),
          `Downloading the voice model — ${p.percent}%`,
          { total: p.total, received: p.received }
        )
      })
      // The config file is small but required — the model cannot be used without it.
      await downloadFile(
        `https://huggingface.co/rhasspy/piper-voices/resolve/main/${voiceConfigUrl(voiceId)}`,
        `${voicePath(voiceId)}.json`,
        () => {}
      ).catch((err) => log.warn("could not download the voice config", String(err)))
    }

    onProgress?.(100, "The offline voice engine is ready.")
    return { ok: true, message: "The offline voice engine is ready." }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn("piper install failed", message)
    return { ok: false, message }
  }
}

/** Remove the runtime and every downloaded voice. */
export function uninstallPiper(): { ok: boolean; message: string } {
  try {
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true })
    if (voicesDir && existsSync(voicesDir)) rmSync(voicesDir, { recursive: true, force: true })
    return { ok: true, message: "The offline voice engine was removed." }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/* ───────────────────────────  Synthesis  ─────────────────────────── */

export interface PiperSynthesisOptions {
  /** 0.5 – 2.0 */
  rate?: number
}

/**
 * Speak with Piper and return the WAV bytes.
 *
 * The text is fed in on standard input and the audio is written to a
 * temporary file, which keeps the process simple and avoids pipe deadlocks.
 */
export async function synthesize(
  text: string,
  voiceId: string,
  options: PiperSynthesisOptions = {}
): Promise<Buffer> {
  if (!isBinaryPresent()) throw new Error("The offline voice engine is not installed.")
  if (!isVoiceInstalled(voiceId)) throw new Error(`The voice "${voiceId}" is not downloaded yet.`)

  const clean = text.trim()
  if (!clean) throw new Error("Nothing to say.")

  const output = join(tmpdir(), `jarvis-piper-${randomUUID()}.wav`)
  // A length scale below 1 speeds the voice up; 1 is the model's own pace.
  const lengthScale = 1 / Math.max(0.4, Math.min(2, options.rate ?? 1))

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        binaryPath(),
        [
          "--model",
          voicePath(voiceId),
          "--output_file",
          output,
          "--length_scale",
          lengthScale.toFixed(2)
        ],
        { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] }
      )

      let stderr = ""
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString()
      })

      // A voice engine that hangs must not hang the assistant with it.
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        reject(new Error("The offline voice engine did not finish in time."))
      }, 60_000)

      child.on("error", (err) => {
        clearTimeout(timer)
        reject(new Error(`Could not run the voice engine: ${err.message}`))
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`The voice engine exited with ${code}: ${stderr.slice(0, 300)}`))
      })

      child.stdin?.end(`${clean}\n`, "utf8")
    })

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFile } = await import("node:fs/promises")
    const data = await readFile(output)
    return data
  } finally {
    try {
      rmSync(output, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/** The voices as the app's voice options. */
export function listVoices(): VoiceOption[] {
  const installed = new Set(installedVoiceIds())
  return PIPER_VOICES.map((v) => ({
    id: v.id,
    name: `${v.name} — offline`,
    language: v.language,
    gender: v.gender,
    engine: "piper" as const,
    jarvisLike: v.jarvisLike,
    local: true,
    installed: installed.has(v.id),
    sizeBytes: v.sizeBytes
  }))
}

/** Write a small marker so the settings know the runtime was installed. */
export function markInstalled(): void {
  try {
    if (!root) return
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, ".installed"), new Date().toISOString())
  } catch {
    /* ignore */
  }
}

export function runtimeSize(): number {
  try {
    return root && existsSync(root) ? statSync(root).size : 0
  } catch {
    return 0
  }
}
