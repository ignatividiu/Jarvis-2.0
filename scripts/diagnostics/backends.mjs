#!/usr/bin/env node
/**
 * Model provider diagnostics.
 *
 *   npm run test:backends
 *
 * Probes every free provider in the catalogue: whether its model list can be
 * read, whether the endpoint answers, and how long it took. Providers that
 * need a key are reported as such rather than treated as failures.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const c = {
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  yellow: (s) => `\u001b[33m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}\u001b[0m`,
  cyan: (s) => `\u001b[36m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "../..")

/**
 * The provider catalogue is TypeScript, so it is read and turned into data
 * rather than imported. Only the fields the probe needs are extracted.
 */
function loadProviders() {
  const source = readFileSync(join(root, "src/main/providers/registry.ts"), "utf8")
  const block = source.slice(source.indexOf("export const PROVIDERS"), source.indexOf("export const PROVIDER_MAP"))
  const providers = []

  const entryRe = /\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*kind:\s*"(cloud|local)",\s*baseUrl:\s*"([^"]+)"([\s\S]*?)\n  \}/g
  let match
  while ((match = entryRe.exec(block)) !== null) {
    const [, id, label, kind, baseUrl, rest] = match
    const envKeys = [...rest.matchAll(/envKeys:\s*\[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((k) => k[1]))
    const keyless = /keyless:\s*true/.test(rest)
    const discover = /discoverModels:\s*true/.test(rest)
    const modelsPath = /modelsPath:\s*"([^"]+)"/.exec(rest)?.[1]
    providers.push({ id, label, kind, baseUrl, envKeys, keyless, discover, modelsPath })
  }
  return providers
}

function resolveKey(provider) {
  for (const name of provider.envKeys) {
    const value = process.env[name]
    if (value && !(provider.id === "ollama" && name === "OLLAMA_HOST")) return value
  }
  return ""
}

async function probeModels(provider) {
  const url = `${provider.baseUrl.replace(/\/$/, "")}${provider.modelsPath ?? "/models"}`
  const key = resolveKey(provider)
  const headers = key ? { Authorization: `Bearer ${key}` } : {}
  const started = Date.now()
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  const text = await res.text()
  const latency = Date.now() - started

  if (!res.ok) {
    return { ok: false, status: res.status, latency, count: 0 }
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    return { ok: false, status: res.status, latency, count: 0 }
  }

  const list = Array.isArray(payload) ? payload : (payload.data ?? payload.models ?? [])
  return { ok: true, status: res.status, latency, count: list.length }
}

async function main() {
  console.log(c.bold("\n  JARVIS 2.0 — model provider diagnostics\n"))

  const providers = loadProviders()
  console.log(c.dim(`  ${providers.length} providers in the catalogue\n`))

  const keyless = providers.filter((p) => p.keyless)
  const withKey = providers.filter((p) => !p.keyless && resolveKey(p))
  const needKey = providers.filter((p) => !p.keyless && !resolveKey(p))

  const heading = (text) => console.log(c.bold(c.cyan(`▸ ${text}`)))

  const probe = async (list, title) => {
    if (!list.length) return
    heading(title)
    for (const provider of list) {
      if (!provider.discover) {
        console.log(`  ${c.dim("·")} ${provider.label} ${c.dim("(no model list endpoint)")}`)
        continue
      }
      try {
        const result = await probeModels(provider)
        if (result.ok) {
          console.log(
            `  ${c.green("✓")} ${provider.label.padEnd(28)} ${c.dim(
              `${result.count} models · ${result.latency} ms`
            )}`
          )
        } else if (result.status === 401 || result.status === 403) {
          console.log(`  ${c.yellow("!")} ${provider.label.padEnd(28)} ${c.dim(`HTTP ${result.status} — needs a key`)}`)
        } else {
          console.log(`  ${c.red("✗")} ${provider.label.padEnd(28)} ${c.dim(`HTTP ${result.status}`)}`)
        }
      } catch (err) {
        console.log(`  ${c.red("✗")} ${provider.label.padEnd(28)} ${c.dim(String(err.message ?? err).slice(0, 60))}`)
      }
    }
  }

  await probe(keyless, "Keyless — working with no account")
  await probe(withKey, "Configured with a key from the environment")

  heading("Needs a key")
  console.log(c.dim(`  ${needKey.map((p) => p.label).join(", ")}\n`))

  console.log(c.dim("  A free key from Google AI Studio or Groq removes every rate limit.\n"))
}

main().catch((err) => {
  console.error(c.red(`\nDiagnostics failed: ${err?.message ?? err}\n`))
  process.exit(1)
})
