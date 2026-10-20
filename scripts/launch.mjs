#!/usr/bin/env node
/**
 * Single command launcher.
 *
 *   npm run launch
 *
 * Builds the app if it has not been built yet, then starts it. In a packaged
 * install this simply opens the already-built application.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" })
    child.on("error", () => resolve(1))
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

const built = existsSync(join(root, "out", "main", "index.js"))

if (!built) {
  console.log("\n  Building JARVIS for the first time…\n")
  const code = await run("npm", ["run", "build"])
  if (code !== 0) {
    console.error("\n  Build failed. Run `npm run setup` for a clean install.\n")
    process.exit(code)
  }
}

const electron = spawnSync("npx", ["electron", "."], {
  stdio: "inherit",
  shell: process.platform === "win32",
  cwd: root
})
process.exit(electron.status ?? 0)
