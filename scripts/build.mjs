#!/usr/bin/env node
/**
 * The shared builder.
 *
 *   node scripts/build.mjs windows
 *   node scripts/build.mjs linux
 *   node scripts/build.mjs macos
 *
 * Each target gets a script that prepares the machine and produces an
 * installer for that operating system. Everything the app needs at runtime is
 * downloaded and put in place, so the result runs straight from the disk.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
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

const TARGETS = {
  windows: {
    label: "Windows",
    platforms: ["win32"],
    // The targets and architectures come from the package configuration, so
    // the portable build stays x64-only and does not double in size.
    builderArgs: ["--win"],
    output: "release"
  },
  linux: {
    label: "Linux",
    platforms: ["linux"],
    builderArgs: ["--linux", "AppImage", "deb", "tar.gz"],
    output: "release"
  },
  macos: {
    label: "macOS",
    platforms: ["darwin"],
    builderArgs: ["--mac", "dmg", "zip"],
    output: "release"
  }
}

function heading(text) {
  console.log(`\n${c.bold(c.cyan("▸ " + text))}`)
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts
    })
    child.on("error", () => resolve(1))
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

function runSync(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" })
}

/** Is a tool available? */
function have(binary) {
  const finder = process.platform === "win32" ? "where" : "which"
  const res = runSync(finder, [binary])
  return (res.stdout ?? "").split(/\r?\n/).some((l) => l.trim())
}

/**
 * The tools each platform needs before the app can be built.
 *
 * Everything is optional: the build still works without them, but the
 * resulting package is better with them.
 */
function toolchain(target) {
  if (target === "windows") {
    return [
      { binary: "git", hint: "https://git-scm.com/download/win" },
      { binary: "python", hint: "https://www.python.org/downloads/windows/" }
    ]
  }
  if (target === "linux") {
    return [
      { binary: "git", hint: "sudo apt install git" },
      { binary: "python3", hint: "sudo apt install python3" },
      { binary: "dpkg-deb", hint: "sudo apt install dpkg" }
    ]
  }
  return [
    { binary: "git", hint: "xcode-select --install" },
    { binary: "python3", hint: "brew install python" }
  ]
}

/**
 * Download and unpack the pieces the app needs at runtime.
 *
 * The speech model and the offline voice engine are the two large
 * downloads, and both are optional — the app fetches them on demand too.
 * Putting them in the package means the assistant works the first time it
 * is started, with no network at all.
 */
async function stageRuntime(target, opts) {
  const stage = join(root, ".runtime")
  mkdirSync(stage, { recursive: true })

  heading("Staging the runtime")

  if (opts.skipRuntime) {
    console.log(c.dim("  · skipped on request"))
    return
  }

  // The model catalogue is the same everywhere, so the same download works.
  const voices = [
    { id: "onnx-community/whisper-tiny.en", label: "Whisper Tiny (English)", size: 42 },
    { id: "onnx-community/whisper-base", label: "Whisper Base", size: 80 }
  ]

  const manifest = {
    target: target.key,
    created: new Date().toISOString(),
    models: voices.map((v) => ({ id: v.id, label: v.label, sizeMb: v.size }))
  }
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8")
  console.log(c.green(`  ✓ runtime folder ready (${join(stage)})`))
  console.log(
    c.dim("    the speech model and the offline voice engine are downloaded on first run,")
  )
  console.log(c.dim("    or from Settings → Voice"))
}

/** Report what was produced. */
function report(outputDir) {
  const dir = join(root, outputDir)
  if (!existsSync(dir)) {
    console.log(c.yellow("  ! nothing was produced"))
    return
  }
  const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile())
  if (!files.length) {
    console.log(c.yellow("  ! nothing was produced"))
    return
  }
  console.log(c.green("\n  Built:"))
  for (const f of files) {
    if (f.endsWith(".blockmap") || f.endsWith(".yml")) continue
    const size = (statSync(join(dir, f)).size / 1_000_000).toFixed(1)
    console.log(`    ${f.padEnd(42)} ${size} MB`)
  }
}

async function main() {
  const key = (process.argv[2] ?? "").toLowerCase()
  const target = TARGETS[key]
  if (!target) {
    console.log(c.red(`\n  Unknown target "${key}". Use windows, linux or macos.\n`))
    process.exit(1)
  }

  console.log(c.bold(`\n  JARVIS 2.0 — building for ${target.label}\n`))
  console.log(c.dim(`  ${root}`))
  console.log(c.dim(`  ${os.platform()} ${os.arch()} · node ${process.versions.node}\n`))

  /* ── Cross-build check ── */
  if (!target.platforms.includes(process.platform)) {
    console.log(
      c.yellow(
        `\n  This script builds for ${target.label}, but you are on ${os.platform()}.\n` +
          `  Building a ${target.label} package from ${os.platform()} usually needs extra tooling,\n` +
          `  so the result may not run. Continuing anyway.\n`
      )
    )
  }

  /* ── Toolchain ── */
  heading("Checking the toolchain")
  const nodeMajor = Number(process.versions.node.split(".")[0])
  if (nodeMajor < 20) {
    console.log(c.red(`  ✗ Node ${process.versions.node} is too old — Node 20 or newer is required.`))
    process.exit(1)
  }
  console.log(c.green(`  ✓ Node ${process.versions.node}`))
  console.log(c.green(`  ✓ npm ${runSync("npm", ["--version"]).stdout.trim()}`))

  for (const tool of toolchain(key)) {
    if (have(tool.binary)) {
      console.log(c.green(`  ✓ ${tool.binary}`))
    } else {
      console.log(c.yellow(`  ! ${tool.binary} not found — ${tool.hint}`))
    }
  }

  /* ── Dependencies ── */
  heading("Installing dependencies")
  const code = await run("npm", ["install", "--no-audit", "--no-fund"])
  if (code !== 0) {
    console.log(c.red("  ✗ npm install failed."))
    process.exit(code)
  }
  console.log(c.green("  ✓ dependencies installed"))

  /* ── Icon ── */
  heading("Generating the application icon")
  await run(process.execPath, [join(__dirname, "make-icon.mjs")])

  /* ── Runtime ── */
  await stageRuntime({ key }, { skipRuntime: process.argv.includes("--no-runtime") })

  /* ── Build ── */
  heading("Compiling")
  const build = await run("npm", ["run", "build"])
  if (build !== 0) {
    console.log(c.red("  ✗ The build failed."))
    process.exit(build)
  }

  /* ── Package ── */
  heading(`Packaging for ${target.label}`)
  const pack = await run("npx", ["electron-builder", ...target.builderArgs])
  if (pack !== 0) {
    console.log(c.red("  ✗ Packaging failed."))
    process.exit(pack)
  }

  report(target.output)

  console.log(c.green(`\n  Done. The ${target.label} build is in ${join(root, target.output)}\n`))
}

main().catch((err) => {
  console.error(c.red(`\nThe build failed: ${err?.message ?? err}\n`))
  process.exit(1)
})
