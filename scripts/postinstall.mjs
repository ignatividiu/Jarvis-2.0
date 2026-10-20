#!/usr/bin/env node
/** Runs after `npm install` — generates the icon if it is missing. */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

if (!existsSync(join(root, "build", "icon.png"))) {
  const res = spawnSync(process.execPath, [join(__dirname, "make-icon.mjs")], { stdio: "inherit" })
  if (res.status !== 0) process.exit(res.status ?? 0)
}
