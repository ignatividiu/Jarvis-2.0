import type { ProviderDefinition, ProviderModel } from "@shared/types"

/**
 * Catalogue of providers that expose a **free** tier.
 *
 * Every entry speaks the OpenAI chat-completions dialect so the rotation
 * engine can treat them uniformly. `keyless` providers work with no
 * credentials at all, which is what makes the assistant usable on first
 * launch without a single signup.
 *
 * `envKeys` lists the environment variables that are probed automatically —
 * if a user already exported `GROQ_API_KEY` the provider lights up with no
 * configuration step.
 *
 * The static model lists are only a **fallback**. The live catalogue is
 * read from each provider's `/models` endpoint whenever possible, because
 * free model names change often and a stale id is the single most common
 * reason a provider appears to be broken.
 */
export const PROVIDERS: ProviderDefinition[] = [
  /* ───────────────────────── Keyless ───────────────────────── */
  {
    id: "pollinations",
    label: "Pollinations (no key)",
    kind: "cloud",
    baseUrl: "https://text.pollinations.ai/openai",
    envKeys: ["POLLINATIONS_API_KEY"],
    keyless: true,
    supportsTools: true,
    discoverModels: true,
    signupUrl: "https://pollinations.ai",
    notes:
      "The only source that works with no account at all. The shared free pool allows one reply every 30 seconds — " +
      "add a key for unlimited replies, and JARVIS will rotate to the other providers in between.",
    rpm: 2,
    minIntervalMs: 30_000,
    models: [
      { id: "openai-fast", name: "OpenAI Fast", free: true, capabilities: ["chat"] },
      { id: "openai", name: "OpenAI (via Pollinations)", free: true, capabilities: ["chat", "code"] },
      { id: "openai-large", name: "OpenAI Large", free: true, capabilities: ["chat", "reasoning"] },
      { id: "mistral", name: "Mistral", free: true, capabilities: ["chat"] },
      { id: "llama", name: "Llama", free: true, capabilities: ["chat"] }
    ]
  },

  /* ──────────────────────── Free tiers ──────────────────────── */
  {
    id: "openrouter",
    label: "OpenRouter (free models)",
    kind: "cloud",
    baseUrl: "https://openrouter.ai/api/v1",
    envKeys: ["OPENROUTER_API_KEY"],
    signupUrl: "https://openrouter.ai/keys",
    supportsTools: true,
    discoverModels: true,
    notes:
      "Dozens of zero-cost models — the model list is read live, so it never goes stale. Models ending in :free are always free. 20 req/min, 50 req/day without a top-up.",
    rpm: 20,
    models: [
      { id: "minimax/minimax-m3.1-flash:free", name: "MiniMax M3.1 Flash", free: true, capabilities: ["chat"] },
      { id: "qwen/qwen3-235b-a22b:free", name: "Qwen3 235B", free: true, capabilities: ["chat", "reasoning"] },
      { id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek V3", free: true, capabilities: ["chat", "code"] },
      { id: "google/gemma-3-27b-it:free", name: "Gemma 3 27B", free: true, capabilities: ["chat"] },
      { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B", free: true, capabilities: ["chat"] }
    ]
  },
  {
    id: "google",
    label: "Google AI Studio (Gemini)",
    kind: "cloud",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    signupUrl: "https://aistudio.google.com/apikey",
    supportsTools: true,
    notes:
      "The most generous free tier available: 1M context on Flash, a real dashboard, and no card required. This is the single best key to add.",
    rpm: 60,
    models: [
      { id: "gemini-flash-latest", name: "Gemini Flash (latest)", free: true, context: 1048576, capabilities: ["chat", "vision", "audio"] },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", free: true, context: 1048576, capabilities: ["chat", "vision", "audio"] },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", free: true, context: 1048576, capabilities: ["chat"] },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", free: true, context: 1048576, capabilities: ["chat", "vision"] }
    ]
  },
  {
    id: "groq",
    label: "Groq",
    kind: "cloud",
    baseUrl: "https://api.groq.com/openai/v1",
    envKeys: ["GROQ_API_KEY"],
    signupUrl: "https://console.groq.com/keys",
    supportsTools: true,
    discoverModels: true,
    notes: "Fastest free inference available. 30 req/min, 1,000 req/day.",
    rpm: 30,
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", free: true, context: 131072, capabilities: ["chat", "code"] },
      { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", free: true, context: 131072, capabilities: ["chat", "reasoning"] },
      { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", free: true, context: 131072, capabilities: ["chat", "reasoning"] },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", free: true, context: 131072, capabilities: ["chat"] },
      { id: "qwen/qwen3-32b", name: "Qwen3 32B", free: true, context: 131072, capabilities: ["chat"] }
    ]
  },
  {
    id: "sambanova",
    label: "SambaNova Cloud",
    kind: "cloud",
    baseUrl: "https://api.sambanova.ai/v1",
    envKeys: ["SAMBANOVA_API_KEY"],
    signupUrl: "https://cloud.sambanova.ai/apis",
    supportsTools: true,
    requiresCard: true,
    discoverModels: true,
    notes: "Standing free tier, 1M tokens/day. A payment method is required on file.",
    rpm: 20,
    models: [
      { id: "Meta-Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", free: true, context: 131072, capabilities: ["chat"] },
      { id: "Qwen3-32B", name: "Qwen3 32B", free: true, context: 131072, capabilities: ["chat"] },
      { id: "Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B", free: true, context: 131072, capabilities: ["chat"] }
    ]
  },
  {
    id: "cerebras",
    label: "Cerebras",
    kind: "cloud",
    baseUrl: "https://api.cerebras.ai/v1",
    envKeys: ["CEREBRAS_API_KEY"],
    signupUrl: "https://cloud.cerebras.ai",
    supportsTools: true,
    requiresCard: true,
    discoverModels: true,
    notes: "Free trial credits. Extremely fast inference — often the quickest source in the pool.",
    rpm: 30,
    models: [
      { id: "llama-3.3-70b", name: "Llama 3.3 70B", free: true, context: 65536, capabilities: ["chat"] },
      { id: "gpt-oss-120b", name: "GPT-OSS 120B", free: true, context: 131072, capabilities: ["chat", "reasoning"] },
      { id: "qwen-3-32b", name: "Qwen3 32B", free: true, context: 65536, capabilities: ["chat"] }
    ]
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    kind: "cloud",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"],
    signupUrl: "https://build.nvidia.com",
    supportsTools: false,
    discoverModels: true,
    notes: "Free build credits with a large catalogue of open models.",
    models: [
      { id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B", free: true, context: 131072, capabilities: ["chat"] },
      { id: "qwen/qwen3-235b-a22b", name: "Qwen3 235B", free: true, context: 131072, capabilities: ["chat", "reasoning"] },
      { id: "deepseek-ai/deepseek-r1", name: "DeepSeek R1", free: true, context: 131072, capabilities: ["chat", "reasoning"] }
    ]
  },
  {
    id: "github",
    label: "GitHub Models",
    kind: "cloud",
    baseUrl: "https://models.github.ai/inference",
    envKeys: ["GITHUB_TOKEN", "GH_TOKEN"],
    signupUrl: "https://github.com/settings/tokens",
    supportsTools: false,
    discoverModels: true,
    modelsPath: "/models",
    notes: "Uses a GitHub personal access token. Programme availability changes — verify before relying on it.",
    models: [
      { id: "openai/gpt-4o-mini", name: "GPT-4o mini", free: true, context: 128000, capabilities: ["chat"] },
      { id: "meta/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", free: true, context: 131072, capabilities: ["chat"] }
    ]
  },
  {
    id: "huggingface",
    label: "Hugging Face Inference",
    kind: "cloud",
    baseUrl: "https://router.huggingface.co/v1",
    envKeys: ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
    signupUrl: "https://huggingface.co/settings/tokens",
    supportsTools: false,
    discoverModels: true,
    notes: "Small monthly credit on every free account, with a very large model catalogue.",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", free: true, context: 131072, capabilities: ["chat"] },
      { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen2.5 72B", free: true, context: 32768, capabilities: ["chat"] }
    ]
  },
  {
    id: "mistral",
    label: "Mistral AI",
    kind: "cloud",
    baseUrl: "https://api.mistral.ai/v1",
    envKeys: ["MISTRAL_API_KEY"],
    signupUrl: "https://console.mistral.ai/api-keys",
    supportsTools: true,
    discoverModels: true,
    notes: "Free 'Experiment' plan. Nemo, Ministral and Codestral are reachable on free keys.",
    models: [
      { id: "open-mistral-nemo", name: "Mistral Nemo", free: true, context: 131072, capabilities: ["chat"] },
      { id: "ministral-3b-latest", name: "Ministral 3B", free: true, context: 131072, capabilities: ["chat"] },
      { id: "codestral-latest", name: "Codestral", free: true, context: 262144, capabilities: ["code"] }
    ]
  },
  {
    id: "cohere",
    label: "Cohere (compatibility API)",
    kind: "cloud",
    baseUrl: "https://api.cohere.com/compatibility/v1",
    envKeys: ["COHERE_API_KEY", "CO_API_KEY"],
    signupUrl: "https://dashboard.cohere.com/api-keys",
    supportsTools: false,
    discoverModels: true,
    notes: "1,000 API calls a month on the trial key.",
    models: [
      { id: "command-r-plus", name: "Command R+", free: true, context: 128000, capabilities: ["chat", "reasoning"] },
      { id: "command-r", name: "Command R", free: true, context: 128000, capabilities: ["chat"] },
      { id: "command-a-03-2025", name: "Command A", free: true, context: 256000, capabilities: ["chat", "reasoning"] }
    ]
  },
  {
    id: "zhipu",
    label: "Z.ai (Zhipu GLM)",
    kind: "cloud",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    envKeys: ["ZHIPU_API_KEY", "ZAI_API_KEY"],
    signupUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    supportsTools: true,
    notes: "GLM free models on the open platform.",
    models: [
      { id: "glm-4-flash", name: "GLM-4 Flash", free: true, context: 128000, capabilities: ["chat"] },
      { id: "glm-4.5-flash", name: "GLM-4.5 Flash", free: true, context: 128000, capabilities: ["chat", "reasoning"] }
    ]
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    kind: "cloud",
    baseUrl: "https://api.siliconflow.cn/v1",
    envKeys: ["SILICONFLOW_API_KEY"],
    signupUrl: "https://cloud.siliconflow.cn/account/ak",
    supportsTools: true,
    notes: "Several models priced at zero.",
    models: [
      { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen2.5 7B", free: true, context: 32768, capabilities: ["chat"] },
      { id: "THUDM/glm-4-9b-chat", name: "GLM-4 9B", free: true, context: 131072, capabilities: ["chat"] }
    ]
  },
  {
    id: "alibaba",
    label: "Alibaba Cloud Model Studio",
    kind: "cloud",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    envKeys: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    signupUrl: "https://bailian.console.alibabacloud.com/",
    supportsTools: true,
    notes: "One-time free quota on the international endpoint.",
    models: [
      { id: "qwen-flash", name: "Qwen Flash", free: true, context: 131072, capabilities: ["chat"] },
      { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus", free: true, context: 262144, capabilities: ["code"] }
    ]
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "cloud",
    baseUrl: "https://api.deepseek.com/v1",
    envKeys: ["DEEPSEEK_API_KEY"],
    signupUrl: "https://platform.deepseek.com/api_keys",
    supportsTools: true,
    notes: "New accounts are topped up with a small free balance.",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat", free: true, context: 131072, capabilities: ["chat", "code"] },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner", free: true, context: 131072, capabilities: ["reasoning"] }
    ]
  },
  {
    id: "moonshot",
    label: "Moonshot AI (Kimi)",
    kind: "cloud",
    baseUrl: "https://api.moonshot.ai/v1",
    envKeys: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    signupUrl: "https://platform.moonshot.ai/console/api-keys",
    supportsTools: true,
    notes: "Free credit for new accounts.",
    models: [
      { id: "kimi-k2-0905-preview", name: "Kimi K2", free: true, context: 262144, capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    kind: "cloud",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    envKeys: ["DEEPINFRA_API_KEY"],
    signupUrl: "https://deepinfra.com",
    supportsTools: true,
    discoverModels: true,
    notes: "Free credits on signup, with many open models served cheaply.",
    models: [{ id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "together",
    label: "Together AI",
    kind: "cloud",
    baseUrl: "https://api.together.xyz/v1",
    envKeys: ["TOGETHER_API_KEY"],
    signupUrl: "https://api.together.ai/settings/api-keys",
    supportsTools: true,
    notes: "Free credits on signup.",
    models: [{ id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", free: true, context: 131072, capabilities: ["chat"] }]
  },
  {
    id: "chutes",
    label: "Chutes.ai",
    kind: "cloud",
    baseUrl: "https://llm.chutes.ai/v1",
    envKeys: ["CHUTES_API_KEY"],
    signupUrl: "https://chutes.ai",
    supportsTools: false,
    notes: "Free credits, and the models are cheap to run at scale.",
    models: [{ id: "chutesai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "kilo",
    label: "Kilo Code Gateway",
    kind: "cloud",
    baseUrl: "https://api.kilo.ai/v1",
    envKeys: ["KILO_API_KEY"],
    signupUrl: "https://kilo.ai",
    supportsTools: true,
    notes: "Gateway that surfaces several free models. Availability varies by region.",
    models: [{ id: "qwen/qwen3-8b:free", name: "Qwen3 8B (free)", free: true, capabilities: ["chat"] }]
  },
  {
    id: "hetzner",
    label: "Hetzner Inference",
    kind: "cloud",
    baseUrl: "https://api.hetzner.ai/v1",
    envKeys: ["HETZNER_API_KEY"],
    signupUrl: "https://console.hetzner.cloud",
    supportsTools: false,
    notes: "Free while the API is experimental — no billing system yet.",
    models: [{ id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", free: true, capabilities: ["chat", "reasoning"] }]
  },
  {
    id: "ovh",
    label: "OVHcloud AI Endpoints",
    kind: "cloud",
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    envKeys: ["OVH_API_KEY"],
    signupUrl: "https://endpoints.ai.cloud.ovh.net/",
    supportsTools: false,
    models: [{ id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "novita",
    label: "Novita AI",
    kind: "cloud",
    baseUrl: "https://api.novita.ai/v3/openai",
    envKeys: ["NOVITA_API_KEY"],
    signupUrl: "https://novita.ai/dashboard",
    supportsTools: false,
    models: [{ id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "nebius",
    label: "Nebius AI Studio",
    kind: "cloud",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    envKeys: ["NEBIUS_API_KEY"],
    signupUrl: "https://studio.nebius.com/",
    supportsTools: false,
    notes: "Free tokens on signup.",
    models: [{ id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "scaleway",
    label: "Scaleway Generative APIs",
    kind: "cloud",
    baseUrl: "https://api.scaleway.ai/v1",
    envKeys: ["SCALEWAY_API_KEY"],
    signupUrl: "https://console.scaleway.com/project/credentials",
    supportsTools: false,
    notes: "One-time free quota.",
    models: [{ id: "meta-llama/Llama-3.1-8b-instruct", name: "Llama 3.1 8B", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "hyperbolic",
    label: "Hyperbolic",
    kind: "cloud",
    baseUrl: "https://api.hyperbolic.xyz/v1",
    envKeys: ["HYPERBOLIC_API_KEY"],
    signupUrl: "https://app.hyperbolic.xyz",
    supportsTools: false,
    notes: "Free credits on signup.",
    models: [{ id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "friendliai",
    label: "FriendliAI",
    kind: "cloud",
    baseUrl: "https://api.friendli.ai/serverless/v1",
    envKeys: ["FRIENDLI_API_KEY"],
    signupUrl: "https://friendli.ai",
    supportsTools: false,
    notes: "Free credits on signup.",
    models: [{ id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "upstage",
    label: "Upstage",
    kind: "cloud",
    baseUrl: "https://api.upstage.ai/v1",
    envKeys: ["UPSTAGE_API_KEY"],
    signupUrl: "https://console.upstage.ai/",
    supportsTools: false,
    models: [{ id: "solar-mini", name: "Solar Mini", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "stepfun",
    label: "StepFun",
    kind: "cloud",
    baseUrl: "https://api.stepfun.com/v1",
    envKeys: ["STEPFUN_API_KEY"],
    signupUrl: "https://platform.stepfun.com/",
    supportsTools: false,
    models: [{ id: "step-1v8k", name: "Step 1V 8K", free: true, context: 8192, capabilities: ["chat"] }]
  },
  {
    id: "requesty",
    label: "Requesty",
    kind: "cloud",
    baseUrl: "https://router.requesty.ai/v1",
    envKeys: ["REQUESTY_API_KEY"],
    signupUrl: "https://app.requesty.ai",
    supportsTools: true,
    notes: "Router with a number of free models.",
    models: [{ id: "openai/gpt-4o-mini", name: "GPT-4o mini", free: true, context: 128000, capabilities: ["chat"] }]
  },
  {
    id: "nanogpt",
    label: "NanoGPT",
    kind: "cloud",
    baseUrl: "https://api.nanogpt.com/api/v1",
    envKeys: ["NANOGPT_API_KEY"],
    signupUrl: "https://nanogpt.com",
    supportsTools: false,
    models: [{ id: "gpt-4o-mini", name: "GPT-4o mini", free: true, context: 128000, capabilities: ["chat"] }]
  },
  {
    id: "nscale",
    label: "Nscale",
    kind: "cloud",
    baseUrl: "https://inference.api.nscale.com/v1",
    envKeys: ["NSCALE_API_KEY"],
    signupUrl: "https://console.nscale.com",
    supportsTools: false,
    models: [{ id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B", free: true, context: 32768, capabilities: ["chat"] }]
  },
  {
    id: "aionlabs",
    label: "Aion Labs",
    kind: "cloud",
    baseUrl: "https://api.aionlabs.ai/v1",
    envKeys: ["AION_API_KEY"],
    signupUrl: "https://aionlabs.ai",
    supportsTools: false,
    models: [{ id: "aion-1.0-mini", name: "Aion 1.0 Mini", free: true, capabilities: ["chat"] }]
  },

  /* ─────────────────────────  Local  ───────────────────────── */
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    envKeys: ["OLLAMA_API_KEY", "OLLAMA_HOST"],
    keyless: true,
    supportsTools: true,
    discoverModels: true,
    notes: "Runs entirely on this machine. Free forever, no account, no rate limit — the most reliable source you can add.",
    models: []
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    kind: "local",
    baseUrl: "http://127.0.0.1:1234/v1",
    envKeys: [],
    keyless: true,
    supportsTools: true,
    discoverModels: true,
    notes: "Detected automatically when LM Studio's local server is running.",
    models: []
  },
  {
    id: "llamacpp",
    label: "llama.cpp server (local)",
    kind: "local",
    baseUrl: "http://127.0.0.1:8080/v1",
    envKeys: [],
    keyless: true,
    supportsTools: true,
    discoverModels: true,
    notes: "Detected automatically when llama-server is running.",
    models: []
  }
]

export const PROVIDER_MAP: Record<string, ProviderDefinition> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p])
)

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDER_MAP[id]
}

/** Providers that are always available because they need no credentials. */
export const KEYLESS_PROVIDERS = PROVIDERS.filter((p) => p.keyless).map((p) => p.id)

/** Model catalogue used when a provider cannot be queried for its model list. */
export const FALLBACK_MODELS: Record<string, ProviderModel[]> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p.models])
)
