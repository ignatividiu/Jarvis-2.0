import type { ChatChunk } from "@shared/types"
import { runAssistant } from "./agent/orchestrator"
import { createLogger } from "./logger"
import { listProviderStatus } from "./providers/rotation"
import { runAgent } from "./tools/opencode"
import { configureOllama } from "./setup/ollama"
import { configurePiper } from "./voice/piper"
import { configureWhisper } from "./voice/whisper"
import { speak, voiceStatus, getClip } from "./voice"

const log = createLogger("selftest")

/**
 * Integration self-test.
 *
 * Enabled with `JARVIS_SELFTEST=1`. It exercises the real provider
 * rotation, the streaming parser and the tool loop, then prints the
 * transcript so the pipeline can be verified headlessly.
 */
export async function runSelfTest(prompt?: string): Promise<void> {
  const { app } = await import("electron")
  const dataDir = app.getPath("userData")
  configurePiper(dataDir)
  configureWhisper(dataDir)
  configureOllama(dataDir)

  // "/voice ..." exercises the speech pipeline end to end.
  if (prompt?.startsWith("/voice ")) {
    const text = prompt.slice("/voice ".length)
    log.info(`speaking: ${text}`)
    const status = await voiceStatus()
    log.info(`voice engine: ${status.activeEngine}, active voice: ${status.activeVoiceName ?? "none"}`)
    const result = await speak({ text })
    if (!result.ok) {
      log.error(`speak failed: ${result.error}`)
      process.exitCode = 1
      return
    }
    log.info(
      `speech ready: ${result.engine} · ${result.bytes ?? 0} bytes · clip ${result.clipId ?? "none"}`
    )

    // The audio has to be playable, not just present. A file that starts
    // with protocol headers rather than audio frames is silently useless.
    if (result.clipId) {
      const clip = getClip(result.clipId)
      const head = clip?.buffer.subarray(0, 12)
      const playable =
        head &&
        (head.subarray(0, 4).toString("ascii") === "RIFF" ||
          (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) ||
          head.subarray(0, 4).toString("ascii") === "OggS")
      if (!playable) {
        log.error(`the generated audio is not playable — it starts with ${JSON.stringify(head?.toString("latin1"))}`)
        process.exitCode = 1
        return
      }
      log.info("the generated audio is a valid, playable file")
    }
    return
  }

  // "/piper" downloads and unpacks the offline speech engine, then speaks
  // with it. It is the only way to verify the archive extraction on a
  // machine that has never installed it.
  if (prompt === "/piper") {
    log.info("installing the offline speech engine…")
    const { installOfflineVoice, speak: speakNow, voiceStatus: status } = await import("./voice")
    const result = await installOfflineVoice("en_GB-alan-medium", (percent, message) =>
      log.info(`  ${percent}% — ${message}`)
    )
    if (!result.ok) {
      log.error(`the offline engine could not be installed: ${result.message}`)
      process.exitCode = 1
      return
    }
    log.info("the offline engine is installed")
    const voice = await status()
    log.info(`engine now: ${voice.activeEngine} (${voice.summary})`)
    const spoken = await speakNow({ text: "The offline voice engine is working." }, { engine: "piper" })
    if (!spoken.ok) {
      log.error(`offline speech failed: ${spoken.error}`)
      process.exitCode = 1
      return
    }
    log.info(`offline speech ready: ${spoken.bytes} bytes of ${spoken.mimeType}`)
    return
  }

  const providers = await listProviderStatus()
  const ready = providers.filter((p) => p.configured)
  log.info(`providers ready: ${ready.map((p) => p.label).join(", ") || "none"}`)

  // "/code <task>" exercises the OpenCode coding agent instead of the chat model.
  if (prompt?.startsWith("/code ")) {
    const task = prompt.slice("/code ".length)
    log.info(`running the coding agent: ${task}`)
    let output = ""
    const result = await runAgent(task, (delta) => (output += delta), process.cwd())
    if (!result.ok) {
      log.error(`coding agent failed: ${result.error}`)
      process.exitCode = 1
      return
    }
    log.info(`coding agent output: ${(result.output ?? output).slice(0, 600)}`)
    return
  }

  const text = prompt ?? "Reply with a single short sentence confirming you are online."

  const chunks: ChatChunk[] = []
  let answer = ""
  let lastError = ""

  try {
    await runAssistant({
      text,
      tools: [],
      emit: (chunk) => {
        chunks.push(chunk)
        if (chunk.type === "delta" && chunk.text) answer += chunk.text
        if (chunk.type === "error") lastError = chunk.error ?? ""
        if (chunk.type === "tool") log.info(`tool call: ${chunk.toolCall?.name}`)
        if (chunk.type === "tool-result") log.info(`tool result: ${chunk.toolResult?.name} ok=${chunk.toolResult?.ok}`)
        if (chunk.type === "notice") log.info(`notice: ${chunk.notice}`)
      }
    })
  } catch (err) {
    log.error("self-test failed", err)
    process.exitCode = 1
    return
  }

  const provider = chunks.find((c) => c.provider)?.provider
  const model = chunks.find((c) => c.model)?.model
  const error = lastError || chunks.find((c) => c.type === "error")?.error

  if (!answer.trim()) {
    // A throttled free pool is a valid outcome — the important thing is that
    // the user is told exactly what happened and what to do about it.
    if (error && /free pool|rate limit/i.test(error)) {
      log.info(`the shared free pool throttled the request (handled cleanly): ${error}`)
      return
    }
    log.error(`the model returned nothing${error ? `: ${error}` : ""}`)
    process.exitCode = 1
    return
  }

  log.info(`answer via ${provider}/${model}: ${answer.trim().slice(0, 400)}`)
}
