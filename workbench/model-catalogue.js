/* ============================================================
   MODEL CATALOGUE  —  researched, real, open-source-first
   ============================================================
   Every OpenRouter id below was checked against the live
   https://openrouter.ai/api/v1/models listing (2026-11-23).
   `free: true` means the provider genuinely serves it at no cost
   (a :free route, or a documented free tier) — not "cheap".
   `open: true` means the weights are published.
   Groq and Google ids were checked against their published model
   and free-tier documentation (their /models endpoints need a key).
   ============================================================ */
const MODEL_CATALOGUE = [
  /* ---- OpenRouter: verified live :free routes ---- */
  { id: 'recursive/flint-v1.0:free', name: 'Recursive Flint (free)', prov: 'openrouter', open: true, free: true, ctx: 262144, tags: ['coding', 'agentic'], note: 'Built for coding agents; always reasons before it answers. Verified live on OpenRouter.' },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (free)', prov: 'openrouter', open: true, free: true, ctx: 262144, tags: ['general', 'coding'], note: 'Verified live on OpenRouter; the most reliable free all-rounder.' },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B A4B (free)', prov: 'openrouter', open: true, free: true, ctx: 262144, tags: ['general', 'coding'], note: 'MoE variant — faster than the 31B, same free route.' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra 550B (free)', prov: 'openrouter', open: true, free: true, ctx: 1000000, tags: ['reasoning', 'long-context'], note: '1M context on a free route. Good for whole-repo questions.' },
  { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron 3.5 Lightning (free)', prov: 'openrouter', open: true, free: true, ctx: 1000000, tags: ['fast', 'long-context'], note: 'Low-latency free route, 1M context.' },
  { id: 'nvidia/nemotron-3.5-super-vl:free', name: 'Nemotron 3.5 Super VL (free)', prov: 'openrouter', open: true, free: true, ctx: 1000000, tags: ['vision', 'long-context'], note: 'Vision + 1M context, free.' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'Nemotron 3 Nano Omni (free)', prov: 'openrouter', open: true, free: true, ctx: 256000, tags: ['reasoning', 'fast'], note: 'Small reasoning model, free.' },
  { id: 'inclusionai/ling-3.2-flash:free', name: 'Ling 3.2 Flash (free)', prov: 'openrouter', open: true, free: true, ctx: 1048576, tags: ['long-context', 'fast'], note: '1M context, free.' },
  { id: 'baidu/ernie-5.5-flash-preview:free', name: 'ERNIE 5.5 Flash (free)', prov: 'openrouter', open: false, free: true, ctx: 1024000, tags: ['long-context'], note: '1M context, free preview route.' },
  { id: 'particle-ai/particle-1:free', name: 'Particle-1 (free)', prov: 'openrouter', open: false, free: true, ctx: 1048576, tags: ['long-context'], note: '1M context, free.' },
  { id: 'dots-studio/dots-3-note-preview:free', name: 'Dots3-Note Preview (free)', prov: 'openrouter', open: false, free: true, ctx: 512000, tags: ['general'], note: '512k context, free preview.' },
  { id: 'liquid/lfm-3-1.7b:free', name: 'LFM3 1.7B (free)', prov: 'openrouter', open: true, free: true, ctx: 262144, tags: ['fast', 'local'], note: 'Tiny and fast; free route.' },
  { id: 'openrouter/free', name: 'OpenRouter auto (free router)', prov: 'openrouter', open: false, free: true, ctx: 0, tags: ['auto'], note: 'Picks a free model for you automatically. 20 req/min, 50/day (1,000/day after 10 credits).' },

  /* ---- OpenRouter: strong open coding models (paid, but cheap) ---- */
  { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder 480B', prov: 'openrouter', open: true, free: false, ctx: 262144, tags: ['coding', 'agentic'], note: 'The strongest dedicated open coder. $0.30/M in — the best value for real coding work.' },
  { id: 'qwen/qwen3-coder-next', name: 'Qwen3 Coder Next', prov: 'openrouter', open: true, free: false, ctx: 262144, tags: ['coding', 'agentic'], note: 'Newer coder generation, $0.12/M in.' },
  { id: 'qwen/qwen3-coder-30b-a3b-instruct', name: 'Qwen3 Coder 30B A3B', prov: 'openrouter', open: true, free: false, ctx: 262144, tags: ['coding', 'fast'], note: 'Small MoE coder — very cheap at $0.07/M in.' },
  { id: 'moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code', prov: 'openrouter', open: true, free: false, ctx: 262144, tags: ['coding', 'agentic'], note: 'Purpose-built for long autonomous coding sessions.' },
  { id: 'z-ai/glm-4.6', name: 'GLM-4.6', prov: 'openrouter', open: true, free: false, ctx: 204800, tags: ['coding', 'agentic'], note: 'Z.ai flagship; excellent tool use and code edits.' },
  { id: 'z-ai/glm-5.3-flash', name: 'GLM-5.3 Flash', prov: 'openrouter', open: true, free: false, ctx: 1048576, tags: ['coding', 'fast'], note: '1M context at $0.04/M in — the cheapest long-context coder here.' },
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', prov: 'openrouter', open: true, free: false, ctx: 1048576, tags: ['coding', 'long-context'], note: '1M context, $0.05/M in.' },
  { id: 'deepseek/deepseek-chat-v3.1', name: 'DeepSeek V3.1', prov: 'openrouter', open: true, free: false, ctx: 163840, tags: ['coding', 'reasoning'], note: 'Strong general + code model, open weights.' },
  { id: 'openai/gpt-oss-120b', name: 'gpt-oss 120B', prov: 'openrouter', open: true, free: false, ctx: 131072, tags: ['coding', 'general'], note: 'OpenAI open-weight; strong on code, $0.05/M in.' },
  { id: 'openai/gpt-oss-20b', name: 'gpt-oss 20B', prov: 'openrouter', open: true, free: false, ctx: 131072, tags: ['coding', 'fast'], note: 'Small, quick, handles code blocks well.' },
  { id: 'mistralai/devstral-2512', name: 'Devstral 2512', prov: 'openrouter', open: true, free: false, ctx: 262144, tags: ['coding', 'agentic'], note: 'Mistral agentic coder.' },
  { id: 'mistralai/codestral-2508', name: 'Codestral 2508', prov: 'openrouter', open: false, free: false, ctx: 256000, tags: ['coding'], note: 'Mistral code specialist.' },
  { id: 'qwen/qwen3.8-27b', name: 'Qwen3.8 27B', prov: 'openrouter', open: true, free: false, ctx: 1024000, tags: ['coding', 'long-context'], note: '1M context at $0.035/M in — remarkable value.' },
  { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', prov: 'openrouter', open: true, free: false, ctx: 524288, tags: ['general'], note: 'Open weights, 512k context.' },
  { id: 'mistralai/mistral-small-3.2-24b-instruct', name: 'Mistral Small 3.2 24B', prov: 'openrouter', open: true, free: false, ctx: 256000, tags: ['general'], note: 'Apache-2.0, very cheap.' },

  /* ---- Groq: documented free tier (30 RPM, 1,000 RPD, 200k tokens/day) ---- */
  { id: 'openai/gpt-oss-120b', name: 'gpt-oss 120B (Groq free)', prov: 'groq', open: true, free: true, ctx: 131072, tags: ['coding', 'fast'], note: 'Free tier: 30 RPM, 1,000 RPD, 8k TPM, 200k tokens/day. Fastest way to run a 120B coder.' },
  { id: 'openai/gpt-oss-20b', name: 'gpt-oss 20B (Groq free)', prov: 'groq', open: true, free: true, ctx: 131072, tags: ['coding', 'fast'], note: 'Free tier, extremely low latency.' },
  { id: 'qwen/qwen3-32b', name: 'Qwen3 32B (Groq free)', prov: 'groq', open: true, free: true, ctx: 40960, tags: ['coding', 'reasoning'], note: 'Free tier: 60 RPM, 1,000 RPD.' },
  { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2 (Groq free)', prov: 'groq', open: true, free: true, ctx: 131072, tags: ['coding', 'agentic'], note: 'Free tier: 60 RPM, 1,000 RPD.' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq free)', prov: 'groq', open: true, free: true, ctx: 131072, tags: ['general'], note: 'Free tier: 30 RPM, 1,000 RPD, 12k TPM.' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (Groq free)', prov: 'groq', open: true, free: true, ctx: 131072, tags: ['fast'], note: 'The most permissive free tier: 14,400 requests/day.' },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout (Groq free)', prov: 'groq', open: true, free: true, ctx: 131072, tags: ['general'], note: 'Free tier, highest TPM (30k).' },
  { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', prov: 'groq', open: true, free: true, ctx: 0, tags: ['audio'], note: 'Speech-to-text, free tier.' },

  /* ---- Google AI Studio: documented free tier ---- */
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', prov: 'google', open: false, free: true, ctx: 1000000, tags: ['coding', 'fast'], note: 'Free of charge on the AI Studio free tier; 1M context.' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', prov: 'google', open: false, free: true, ctx: 1000000, tags: ['fast'], note: 'Free tier.' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', prov: 'google', open: false, free: true, ctx: 1000000, tags: ['fast'], note: 'Free tier, cheapest latency.' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', prov: 'google', open: false, free: true, ctx: 1000000, tags: ['coding', 'reasoning'], note: 'Free tier (deprecated for new projects; routes to 3.8 Flash from 1 Dec).' },
  { id: 'gemma-4-31b-it', name: 'Gemma 4 31B (AI Studio)', prov: 'google', open: true, free: true, ctx: 262144, tags: ['general', 'coding'], note: 'Open weights, free tier on AI Studio.' },

  /* ---- Local, no key, no cost ---- */
  { id: 'qwen2.5-coder:7b', name: 'Qwen2.5 Coder 7B (local)', prov: 'ollama', open: true, free: true, ctx: 32000, tags: ['coding', 'local'], note: 'Runs on your machine via Ollama. No key, no cost, no rate limit.' },
  { id: 'qwen2.5-coder:32b', name: 'Qwen2.5 Coder 32B (local)', prov: 'ollama', open: true, free: true, ctx: 32000, tags: ['coding', 'local'], note: 'Best local coder if you have the VRAM.' },
  { id: 'deepseek-coder-v2:16b', name: 'DeepSeek Coder V2 16B (local)', prov: 'ollama', open: true, free: true, ctx: 128000, tags: ['coding', 'local'], note: 'Local, open weights.' },
  { id: 'devstral:24b', name: 'Devstral 24B (local)', prov: 'ollama', open: true, free: true, ctx: 128000, tags: ['coding', 'agentic', 'local'], note: 'Mistral agentic coder, local.' },
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B (local)', prov: 'ollama', open: true, free: true, ctx: 128000, tags: ['fast', 'local'], note: 'Tiny and quick on CPU.' },

  /* ---- Paid, first-class (kept for completeness) ---- */
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', prov: 'anthropic', open: false, free: false, ctx: 200000, tags: ['coding', 'agentic'], note: 'Paid. Excellent at large refactors.' },
  { id: 'gpt-4.1', name: 'GPT-4.1', prov: 'openai', open: false, free: false, ctx: 1000000, tags: ['coding'], note: 'Paid.' }
];

function catalogueFor(provKey) {
  return MODEL_CATALOGUE.filter((m) => m.prov === provKey);
}
function freeModels() {
  return MODEL_CATALOGUE.filter((m) => m.free);
}
function codingModels() {
  return MODEL_CATALOGUE.filter((m) => m.tags.indexOf('coding') >= 0);
}
