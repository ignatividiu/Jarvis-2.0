#!/usr/bin/env node
/**
 * One-command bootstrap.
 *
 *   npm run setup
 *
 * Checks the toolchain, installs dependencies, generates the app icon and
 * reports exactly what is still missing. It never installs anything globally
 * and never requires administrator rights.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const c = {
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  yellow: (s) => `\u001b[33m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}\u001b[0m`,
  cyan: (s) => `\u001b[36m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts })
    child.on("error", () => resolve(1))
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

function which(bin) {
  const res = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" })
  const first = (res.stdout ?? "").split(/\r?\n/).find((l) => l.trim())
  return first ? first.trim() : null
}

function heading(text) {
  console.log(`\n${c.bold(c.cyan("▸ " + text))}`)
}

async function main() {
  console.log(c.bold("\n  JARVIS 2.0 — desktop AI assistant"))
  console.log(c.dim(`  ${root}\n`))

  /* ── Toolchain ── */
  heading("Checking the toolchain")

  const nodeMajor = Number(process.versions.node.split(".")[0])
  if (nodeMajor < 20) {
    console.log(c.red(`  ✗ Node ${process.versions.node} is too old — Node 20 or newer is required.`))
    process.exit(1)
  }
  console.log(c.green(`  ✓ Node ${process.versions.node}`))
  console.log(c.green(`  ✓ npm ${spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout.trim()}`))
  console.log(c.dim(`  ✓ ${os.platform()} ${os.arch()} · ${os.cpus()[0]?.model ?? "unknown CPU"}`))

  for (const tool of ["git", "curl"]) {
    const path = which(tool)
    console.log(path ? c.green(`  ✓ ${tool} — ${path}`) : c.yellow(`  ! ${tool} not found (optional)`))
  }

  /* ── Dependencies ── */
  heading("Installing dependencies")
  if (!existsSync(join(root, "node_modules"))) {
    const code = await run("npm", ["install", "--no-audit", "--no-fund"])
    if (code !== 0) {
      console.log(c.red("  ✗ npm install failed."))
      process.exit(code)
    }
  } else {
    console.log(c.dim("  · node_modules already present — running npm install to sync"))
    await run("npm", ["install", "--no-audit", "--no-fund"])
  }
  console.log(c.green("  ✓ dependencies installed"))

  /* ── Icon ── */
  heading("Generating the application icon")
  await run(process.execPath, [join(__dirname, "make-icon.mjs")])

  /* ── Optional companions ── */
  heading("Checking optional companions")

  const ollama = which("ollama")
  console.log(
    ollama
      ? c.green(`  ✓ Ollama found at ${ollama}`)
      : c.yellow("  ! Ollama not installed — the app can download a portable copy for you")
  )

  const opencode = which("opencode")
  console.log(
    opencode
      ? c.green(`  ✓ opencode found at ${opencode}`)
      : c.yellow("  ! opencode not found — install it from https://opencode.ai to enable the coding agent")
  )

  console.log(
    c.dim("  · The voice engine needs nothing: the online voices are free and\n") +
      c.dim("    the setup wizard downloads the speech model and the offline engine.\n")
  )

  /* ── Launchers ── */
  heading("Creating launchers")
  const binDir = join(root, "bin")
  mkdirSync(binDir, { recursive: true })

  if (process.platform === "win32") {
    const cmd = `@echo off\r\nrem JARVIS launcher\r\ncd /d "%~dp0.."\r\ncall npm run dev\r\n`
    writeFileSync(join(binDir, "jarvis.cmd"), cmd)
    console.log(c.green("  ✓ bin/jarvis.cmd"))
  } else {
    const sh = `#!/usr/bin/env bash\nset -e\ncd "$(dirname "$0")/.."\nexec npm run dev "$@"\n`
    writeFileSync(join(binDir, "jarvis.sh"), sh)
    spawnSync("chmod", ["+x", join(binDir, "jarvis.sh")])
    console.log(c.green("  ✓ bin/jarvis.sh"))
  }

  /* ── Summary ── */
  heading("Ready")
  console.log(c.green("  npm run dev      ") + c.dim("launch the app for development"))
  console.log(c.green("  npm run build    ") + c.dim("compile main, preload and renderer"))
  console.log(c.green("  npm run dist     ") + c.dim("package installers for this platform"))
  console.log(c.green("  npm run dist:all ") + c.dim("package for Windows, macOS and Linux"))
  console.log(c.green("  npm run test:voice") + c.dim("check the speech engines"))
  console.log(c.dim("\n  On first launch the setup wizard connects the free model providers,\n"))
  console.log(c.dim("  downloads the speech model and prepares the JARVIS voice.\n"))
}

main().catch((err) => {
  console.error(c.red(`\nSetup failed: ${err?.message ?? err}\n`))
  process.exit(1)
})
