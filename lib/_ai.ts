// One AI client for the whole site. Works with any chat API that uses the OpenAI request format:
// NVIDIA, Mistral, OpenAI, Groq, OpenRouter, or your own server. Nothing is hard-wired to one model.
//
// Vercel settings (all optional except a provider key):
//   AI_PROVIDER      nvidia | mistral | custom          (default: mistral if only MISTRAL_API_KEY is set, else nvidia)
//   AI_API_KEY       key for the chosen provider       (or use NVIDIA_API_KEY / MISTRAL_API_KEY)
//   AI_BASE_URL      required for custom, e.g. https://api.openai.com/v1
//   AI_MODEL         text model name, exactly as the provider lists it
//   AI_VISION_MODEL  model used for chart images (must accept images)
// NVIDIA_MODEL / NVIDIA_VISION_MODEL still work for NVIDIA. Any failure returns null, so nothing else is blocked.

export type Endpoint = { url: string; key: string; model: string; provider: string }
export type AiResult = { ok: true; text: string; model: string } | { ok: false; status: number | null; model: string; detail: string }

const PRESETS: Record<string, { url: string; keyEnv: string; text: string; vision: string }> = {
  nvidia: { url: 'https://integrate.api.nvidia.com/v1', keyEnv: 'NVIDIA_API_KEY', text: 'mistralai/mistral-medium-3.5-128b', vision: 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1' },
  mistral: { url: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY', text: 'mistral-large-latest', vision: 'pixtral-large-latest' },
}

const env = (k: string) => (process.env[k] ?? '').trim()

export function aiProvider(): string {
  const set = env('AI_PROVIDER').toLowerCase()
  if (set) return set
  return env('MISTRAL_API_KEY') && !env('NVIDIA_API_KEY') ? 'mistral' : 'nvidia'
}

export function aiEndpoint(kind: 'text' | 'vision'): Endpoint | null {
  const provider = aiProvider()
  const preset = PRESETS[provider]
  const base = env('AI_BASE_URL') || preset?.url || ''
  const key = env('AI_API_KEY') || (preset ? env(preset.keyEnv) : '')
  if (!base || !key) return null
  const isNvidia = provider === 'nvidia'
  const specific = kind === 'vision' ? env('AI_VISION_MODEL') || (isNvidia ? env('NVIDIA_VISION_MODEL') : '') : env('AI_MODEL') || (isNvidia ? env('NVIDIA_MODEL') : '')
  const general = env('AI_MODEL') || (isNvidia ? env('NVIDIA_MODEL') : '')
  const model = specific || (kind === 'vision' ? (preset?.vision ?? general) : (preset?.text ?? general))
  if (!model) return null
  return { url: `${base.replace(/\/$/, '')}/chat/completions`, key, model, provider }
}

// Mistral takes the image as a plain data-URL string; the OpenAI format takes an object with a url.
function imagePart(provider: string, dataUrl: string) {
  return provider === 'mistral' ? { type: 'image_url', image_url: dataUrl } : { type: 'image_url', image_url: { url: dataUrl } }
}

async function send(ep: Endpoint, messages: unknown[], maxTokens: number, timeoutMs: number): Promise<AiResult> {
  try {
    const r = await fetch(ep.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: ep.model, max_tokens: maxTokens, temperature: 0.1, messages }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) return { ok: false, status: r.status, model: ep.model, detail: (await r.text().catch(() => '')).slice(0, 200) }
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const text = (j.choices?.[0]?.message?.content ?? '').trim()
    if (!text) return { ok: false, status: r.status, model: ep.model, detail: 'The model returned no text.' }
    return { ok: true, text: text.slice(0, 4000), model: ep.model }
  } catch (e) {
    return { ok: false, status: null, model: ep.model, detail: (e as Error).message.slice(0, 160) }
  }
}

export async function askModel(prompt: string, timeoutMs = 20000): Promise<string | null> {
  const ep = aiEndpoint('text')
  if (!ep) return null
  const r = await send(ep, [{ role: 'user', content: prompt }], 200, timeoutMs)
  return r.ok ? r.text.slice(0, 600) : null
}

export async function askVision(prompt: string, dataUrl: string, timeoutMs = 45000): Promise<AiResult> {
  const ep = aiEndpoint('vision')
  if (!ep) return { ok: false, status: null, model: '', detail: 'No AI provider is set up. Add AI_PROVIDER and its key in Vercel.' }
  return send(ep, [{ role: 'user', content: [{ type: 'text', text: prompt }, imagePart(ep.provider, dataUrl)] }], 700, timeoutMs)
}
