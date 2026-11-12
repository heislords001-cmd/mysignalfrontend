// Shared model call for the site. Reads NVIDIA_API_KEY and NVIDIA_MODEL from Vercel.
// An empty NVIDIA_MODEL falls back to the default, and every failure returns null so nothing else is blocked.
export const DEFAULT_TEXT_MODEL = 'mistralai/mistral-medium-3.5-128b'

export function aiModel(): string {
  return (process.env.NVIDIA_MODEL ?? '').trim() || DEFAULT_TEXT_MODEL
}

export async function askModel(prompt: string, timeoutMs = 20000): Promise<string | null> {
  const key = (process.env.NVIDIA_API_KEY ?? '').trim()
  if (!key) return null
  try {
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: aiModel(), max_tokens: 200, temperature: 0.1, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const text = (j.choices?.[0]?.message?.content ?? '').trim()
    return text ? text.slice(0, 600) : null
  } catch {
    return null
  }
}
