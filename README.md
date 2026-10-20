<div align="center">

# JARVIS 2.0

**A free-model desktop AI assistant with a voice you can actually rely on.**

Runs on free models in rotation · speaks with the best free voices available · hears you through the
microphone · searches the web · writes code · and works entirely on your own machine.

[![Electron](https://img.shields.io/badge/electron-44-47848F?logo=electron&logoColor=white)](https://electronjs.org)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-3ddc97.svg)](LICENSE)

</div>

---

## Contents

- [What it does](#what-it-does)
- [The voice system](#the-voice-system)
  - [Speaking](#speaking)
  - [Listening](#listening)
  - [Always-on and the wake word](#always-on-and-the-wake-word)
  - [Push to talk](#push-to-talk)
  - [Microphone and speaker](#microphone-and-speaker)
- [The models](#the-models)
  - [Provider catalogue](#provider-catalogue)
  - [Live model discovery](#live-model-discovery)
  - [Rotation and the circuit breaker](#rotation-and-the-circuit-breaker)
- [Tools](#tools)
- [The OpenCode coding agent](#the-opencode-coding-agent)
- [Local models](#local-models)
- [Web search](#web-search)
- [The interface](#the-interface)
- [Getting started](#getting-started)
- [Building](#building)
- [Diagnostics](#diagnostics)
- [How the voice pipeline works](#how-the-voice-pipeline-works)
- [Configuration reference](#configuration-reference)
- [Project layout](#project-layout)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)
- [Licence](#licence)

---

## What it does

JARVIS is a desktop assistant for people who do not want to pay for an API and do not want their
microphone or their files leaving the machine. It is a single Electron application that:

- **Talks.** It speaks its replies aloud in a composed British voice, and it listens for you to talk
  back.
- **Listens on command.** Leave the microphone open and it waits for its name; or hold a key and talk.
- **Thinks.** It rotates across 36 free model providers, failing over automatically when one is
  rate-limited, broken or out of quota.
- **Looks things up.** Web search, page reading, arithmetic, and system information are all available
  to the model as tools.
- **Writes code.** It hands programming work to the OpenCode coding agent, which can read and write
  files and run commands.
- **Runs models locally.** Ollama is downloaded and configured for you, so a model can run on your own
  hardware with no limits.
- **Looks good.** A Material Design 3 interface with a live audio visualiser.

Everything is free. There is no account, no trial, and no key required to get started.

---

## The voice system

Version 1.0 of JARVIS delegated speech to **Voicebox**, a separate third-party desktop application
that had to be installed by hand, had no Linux build, needed its own server on a fixed port, and
frequently failed to launch. Version 2.0 removes that dependency entirely and manages the speech
engines itself.

### Speaking

| Engine | Account | Internet | Voices | Notes |
|---|---|---|---|---|
| **Edge read-aloud** (default) | not needed | needed | 322 | Microsoft's free read-aloud service. The best sounding option, and `en-GB-RyanNeural` is remarkably close to the classic JARVIS delivery. |
| **Piper** (offline) | not needed | **not needed** | 12 | A small native engine, downloaded on demand (~85 MB with a voice). Generates about 40× faster than real time. Works with no connection at all. |
| **System voice** | not needed | not needed | OS | The operating system's own speech synthesis. Always present, and the last line of defence. |

The chain is automatic: with `engine: "auto"` the assistant prefers the online engine, falls back to
the offline one, and finally to the system voice.

**Customising the delivery.** The assistant takes a plain-English description of how it should sound
("calm, composed, a butler who is three steps ahead"). That description is matched against the
expressive styles the selected voice supports — *calm*, *newscast*, *cheerful*, *serious* and so on —
and the closest style is applied. Speed, pitch and volume are adjustable separately.

**Changing the voice.** The Voice tab lists every voice from every engine, grouped and searchable,
with the JARVIS-like voices marked. One click plays a test phrase through the real output path.

### Listening

| Engine | Account | Internet | Notes |
|---|---|---|---|
| **Local Whisper** (default) | not needed | **not needed** | Runs through `transformers.js` on the ONNX runtime. Four model sizes from 42 MB to 900 MB. Your audio never leaves the machine. |
| **Browser recogniser** | not needed | needed | The Web Speech API. No download, but less dependable, and unavailable in some Electron builds. |

Recognition is fast enough to be interactive: the *Whisper Tiny* model recognises a one-second
phrase in roughly **160 ms** on a modern laptop.

### Always-on and the wake word

The **Always on** switch in the voice dock keeps the microphone open. JARVIS then works out where a
phrase begins and ends, recognises it locally, and only answers when its name was used.

- The wake word defaults to **jarvis** and is configurable.
- Near-misses are understood: *jarvus*, *jervis*, *harvis* and *jarvy* all work.
- The name has to be near the beginning, so *"tell me about jarvis"* does **not** wake it up.
- Say only *"jarvis"* and it stays awake for the command that follows.
- A second mode, **Open**, answers every phrase without a wake word.
- The microphone is released the moment you switch always-on off — the operating system's recording
  indicator goes out.

The detector uses an **adaptive noise floor**: the threshold always sits a fixed distance above the
quietest recent sound, so a desk fan does not trigger the assistant, and a short pre-roll means the
first phoneme is never clipped.

### Push to talk

Hold the microphone button in the composer, or the **Hold to talk** button in the voice dock. The
default keyboard shortcut is `Ctrl+Space` and is configurable in the Voice tab. The transcript is
sent the moment you let go.

The assistant never answers itself: audio captured while it is talking is discarded, and utterances
arriving in the two seconds after it stops are ignored, so the room's reverberation cannot start a
loop.

### Microphone and speaker

Settings → **Microphone & speaker** lists every input and output device, and the voice dock has
quick pickers for both. The selected speaker is applied with `AudioContext.setSinkId`, so the choice
covers every engine, including the offline one. The system's own speech engine always uses the
default output — that is a limitation of the operating system, not of the app.

---

## The models

### Provider catalogue

36 providers, every one of them with a free tier:

| | Providers |
|---|---|
| **No account at all** | Pollinations, Ollama, LM Studio, llama.cpp |
| **Free key** | Google AI Studio, Groq, OpenRouter, Cerebras, NVIDIA NIM, GitHub Models, Hugging Face, Mistral, Cohere, Z.ai, SiliconFlow, Alibaba, DeepSeek, Moonshot, DeepInfra, Together, Chutes, Kilo, Hetzner, OVH, Novita, Nebius, Scaleway, Hyperbolic, Friendli, Upstage, StepFun, Requesty, NanoGPT, Nscale, Aion Labs |

Keys are encrypted with the operating system's keychain and never leave the machine. Environment
variables (`GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, …) are picked up automatically,
so an existing setup needs no configuration at all.

**For a smooth experience, add one free key.** Google AI Studio is the most generous, Groq is the
fastest, and OpenRouter has dozens of `:free` models.

### Live model discovery

The single biggest reason a provider appears to be broken is a **stale model name**. Free model ids
are renamed and retired constantly, and a hard-coded list goes wrong within weeks.

JARVIS 2.0 reads the live catalogue from each provider's `/models` endpoint and only falls back to a
built-in list when the live one cannot be reached. The built-in lists are refreshed as well, and
**Refresh models** re-reads any provider on demand.

### Rotation and the circuit breaker

Every provider is tracked with a small circuit breaker:

- **closed** — working, used normally.
- **open** — just failed, skipped for a while.
- **half-open** — the cooldown expired, so one probe is allowed through to see whether it has
  recovered.

Without that, a single broken provider could swallow every attempt and leave the assistant with
nothing to say. A provider that serves no known model is skipped rather than called with a made-up
name.

Five strategies are available:

| Strategy | Behaviour |
|---|---|
| **Round robin** | Cycle through every ready source in turn. The default. |
| **Priority** | Always prefer the first source in the list. |
| **Lowest latency** | Pick whichever source has been responding fastest. |
| **Quota aware** | Spread load evenly and back off from rate limits. |
| **Random** | Pick a source at random for each request. |

The shared keyless pool allows one reply every thirty seconds, so JARVIS waits rather than failing.
**Test every source** in the providers tab probes all of them at once and reports which answer.

---

## Tools

The model can call seven tools, and the tool loop runs automatically.

| Tool | What it does |
|---|---|
| `web_search` | Searches the internet for current information. |
| `fetch_url` | Reads the full text of a web page. |
| `code_task` | Delegates a programming task to the OpenCode coding agent. |
| `list_local_models` | Lists the models installed on this machine, and those available to download. |
| `install_local_model` | Downloads a model so it can run locally and privately. |
| `system_info` | Reports the date, time, operating system and machine details. |
| `calculate` | Evaluates an arithmetic expression exactly. |

Providers that cannot do native tool calling get a text protocol instead, so the tool loop works on
every free model.

---

## The OpenCode coding agent

JARVIS can hand programming work to **OpenCode**, which reads and writes files, runs commands and
searches the codebase. The server is started automatically, and the port is remembered between
sessions.

- **Code mode** in the composer routes the request to the coding agent.
- **Route code questions automatically** sends anything that looks like a programming task its way.
- The working directory is configurable, and the session list is available in the HUD.

---

## Local models

**Ollama** is downloaded into the app's own folder — no administrator rights, no system-wide
install — and started as a child process. LM Studio and a llama.cpp server are detected
automatically when they are already running.

A catalogue of sensible models is offered, with their sizes and a note on what each is good for.
The **4B** and **8B** models are comfortable on a laptop; the smaller ones are for CPU-only
machines. Nothing leaves the machine.

---

## Web search

Six backends, chosen automatically or pinned by hand:

| Backend | Account | Notes |
|---|---|---|
| **DuckDuckGo** | not needed | The default. Free, no key. |
| **Wikipedia** | not needed | Encyclopedic results. |
| **Tavily** | free key | Good structured results. |
| **Brave** | free key | Large independent index. |
| **SearXNG** | your instance | Self-hosted; the URL is configurable. |
| **OpenCode** | not needed | Uses the coding agent's own search. |

---

## The interface

**Material Design 3**, with a light theme, a dark theme and a follow-the-system option. The accent
colour is configurable.

**Five visualisers** react to the live audio — the microphone when you are speaking, the assistant's
own voice when it is replying:

`Orb` · `Reactor` · `Spectrum` · `Waveform` · `Grid`

The visualiser can be expanded to fill the whole window, which turns the assistant into an ambient
display.

**The voice dock** sits above the composer and holds the always-on switch, the push-to-talk button
and the device pickers, so the things you reach for most are always one click away.

---

## Getting started

```bash
git clone <your-repository-url>
cd jarvis
npm install
npm run dev
```

`npm install` runs `scripts/postinstall.mjs`, which generates the application icon.

To check the toolchain and create the launchers:

```bash
npm run setup
```

On first launch the setup wizard walks through the model providers, the local runtime and the
speech model. Everything is optional — the assistant works with no account at all.

**Requirements:** Node 20 or newer. Nothing else.

---

## Building

```bash
npm run build        # compile main, preload and renderer
npm run typecheck    # strict TypeScript, both projects
npm run dist         # package for the current platform
npm run dist:win     # Windows installer and portable build
npm run dist:mac     # macOS disk image and zip
npm run dist:linux   # AppImage, deb and tarball
npm run dist:all     # all three
```

The Windows build produces a per-user installer, an arm64 installer and a portable executable. The
macOS build is signed with the entitlements in `build/entitlements.mac.plist`, including microphone
access.

---

## Diagnostics

```bash
npm run test:voice      # the whole voice stack, without launching the app
npm run test:backends   # every provider in the catalogue
```

`test:voice` checks the online engine, the offline engine, the local recogniser, the wake word
matcher and the voice activity detector — including that the generated audio is a genuinely
playable file and not protocol headers. It is the fastest way to find out whether the voice works
on a new machine.

---

## How the voice pipeline works

```
 microphone ──► 16 kHz capture ──► voice activity detector
                                            │
                        ┌───────────────────┴───────────────────┐
                        │                                       │
                  push to talk                          always on
                        │                                       │
                        └──────────► Whisper (local) ◄───────────┘
                                            │
                                   transcript text
                                            │
                                   wake word matcher
                                            │
                                     command ──► chat ──► reply
                                                                    │
                                             Edge / Piper / system
```

- **Capture** — the renderer opens an `AudioContext` at 16 kHz, so the browser resamples the
  microphone itself. The samples move to the main process over IPC and are recognised by the local
  Whisper model.
- **Activity detection** — an adaptive noise floor splits the stream into utterances.
- **Wake word** — `src/shared/wake.ts` is shared by both sides and is covered by the diagnostics.
- **Speaking** — the main process synthesises the audio and keeps it in a small cache; the renderer
  streams it back through a custom protocol, decodes it and plays it through the Web Audio graph,
  which is what drives the visualiser while JARVIS talks.

The Edge service prefixes every binary frame with a two-byte header length and a block of headers.
Those have to be stripped before the audio is decoded — see `src/main/voice/edge.ts`.

---

## Configuration reference

Everything is editable in the interface, and stored in `%APPDATA%/jarvis-2.0/jarvis2.config.json`.

| Group | Setting | Default | Notes |
|---|---|---|---|
| **Voice** | `engine` | `auto` | `auto`, `edge`, `piper` or `browser` |
| | `sttEngine` | `auto` | `auto`, `whisper` or `browser` |
| | `voiceId` | `en-GB-RyanNeural` | The voice used for replies |
| | `instruct` | — | How the assistant should sound, in plain English |
| | `style` | — | An explicit expressive style, e.g. `calm` |
| | `language` | `en-GB` | The accent of the generated speech |
| | `rate` / `pitch` / `volume` | `1` | Delivery |
| | `sttModel` | `whisper-tiny.en` | The recognition model |
| | `alwaysOn` | `false` | Keep the microphone open |
| | `wakeMode` | `wake-word` | `wake-word`, `open` or `off` |
| | `wakeWord` | `jarvis` | The word that wakes the assistant |
| | `wakeSensitivity` | `0.5` | Higher triggers more easily |
| | `silenceTimeoutMs` | `1200` | How long to wait for the rest of a sentence |
| | `pushToTalkKey` | `Ctrl+Space` | The hold-to-talk shortcut |
| | `inputDeviceId` / `outputDeviceId` | — | The chosen devices |
| **Persona** | `name` | `JARVIS` | |
| | `instructions` | — | How the assistant should behave |
| | `speak` | `true` | Read the replies aloud |
| **Rotation** | `strategy` | `round-robin` | See the strategies above |
| | `maxAttempts` | `5` | How many sources may be tried |
| | `temperature` / `maxTokens` | `0.7` / `2048` | |
| | `modelPreference` | — | A chosen model per provider |
| **Agent** | `toolsEnabled` | `true` | Let the model call tools |
| | `autoRouteCode` | `false` | Send code questions to OpenCode |
| | `maxToolIterations` | `6` | Tool calls per request |
| **Local** | `enabled` / `autostart` | `true` | The Ollama runtime |
| | `model` | — | The preferred local model |
| **OpenCode** | `enabled` / `autostart` | `true` | The coding agent |
| | `port` / `directory` | `4096` | |
| **Web** | `engine` | `auto` | The search backend |
| | `searxngUrl` | — | Your SearXNG instance |
| | `maxResults` | `6` | |
| **Interface** | `theme` | `dark` | `dark`, `light` or `system` |
| | `visualizer` | `orb` | The visualiser |
| | `accent` | `#3ddc97` | The accent colour |

---

## Project layout

```
src/
  main/
    providers/      the free provider catalogue and the rotation engine
    agent/          the tool loop and the system prompt
    voice/          edge · piper · whisper · the engine facade
    tools/          local models, OpenCode, web search
    setup/          the Ollama installer
  preload/          the bridge between the two sides
  renderer/src/
    audio/          capture, activity detection, playback, devices
    components/     the interface, including the voice dock
    state/          the shared store
  shared/           the IPC contract and the wake word matcher
scripts/
  bootstrap.mjs     the one-command setup
  launch.mjs        the one-command launcher
  diagnostics/      the voice and provider checks
```

---

## Privacy

- **Speech recognition is local.** The audio is recognised by Whisper on your machine and is never
  sent anywhere.
- **The offline voice engine is local.** The audio is synthesised on your machine.
- **API keys are encrypted** with the operating system keychain and stored in the app's own data
  folder.
- **Local models are local.** A model pulled through Ollama never leaves the machine.
- The only network traffic is the requests you make: the model provider you are talking to, the
  search backend you are using, and — unless you install the offline voice engine — the Edge speech
  service, which receives the text to be spoken.

---

## Troubleshooting

**The assistant does not hear anything.**
Check that the microphone in Settings → Microphone & speaker is the right one, and that the
operating system has granted permission. *Allow microphone access* opens the microphone once so the
device names become visible.

**The assistant does not speak.**
Look at the log at `%APPDATA%/jarvis-2.0/logs/jarvis.log`. The line
`[jarvis] played N.NNs of audio` means the clip was played; if it is missing, the engine failed.
`npm run test:voice` checks the whole chain.

**The models are not working.**
Open Settings → Model providers and press **Test every source**. A provider that needs a key will
say so. A provider with a red dot has just failed and is being skipped for a while.

**Ollama says the model is not found.**
The app asks the runtime for its installed models and uses the first one. Download a model in
Settings → Local models, then press **Refresh models** in the providers tab.

**The assistant talks to itself.**
The echo guard is on. If it still happens, the wake mode is probably set to *Open* — switch it to
*Wake word* in the Voice tab.

---

## Licence

MIT. See [LICENSE](LICENSE).

The engines JARVIS uses are free and open: Microsoft's Edge read-aloud service, the Piper
text-to-speech engine, OpenAI's Whisper, Ollama and OpenCode.
