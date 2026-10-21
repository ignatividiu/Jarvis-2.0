#!/usr/bin/env node
/**
 * Build the Windows installer.
 *
 *   npm run build:windows
 *
 * Produces an NSIS installer for x64 and arm64, plus a portable executable
 * that runs without being installed. Everything the app needs at runtime is
 * downloaded and staged, so the result works straight from the disk.
 */
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const args = process.argv.slice(2)
const child = spawn(process.execPath, [join(__dirname, "build.mjs"), "windows", ...args], {
  stdio: "inherit",
  cwd: root
})
child.on("exit", (code) => process.exit(code ?? 0))
