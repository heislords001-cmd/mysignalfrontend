// Optional chart reading. A member uploads a chart screenshot; a vision model describes what it sees.
// It is an OPINION, never a signal: it does not create signals, executions or trades.
// Trade levels come only from our own market data (market_state), shown next to the read for reference.
// The image is used for the one request and is NOT stored. Only the text read is saved.
import { dbHeaders, env, userFromJwt } from './_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { image?: string } }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

const PAIRS = ['EURUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'AUDUSD', 'XAUUSD']
const TIMEFRAMES = ['M5', 'M15', 'H1', 'H4', 'D1']
const MAX_BYTES = 2 * 1024 * 1024
const DAILY_LIMIT = 10
const MODEL = process.env.NVIDIA_VISION_MODEL || 'mistralai/mistral-medium-3.5-128b'

// Checks the real file type from its first bytes, not just the text the browser sends
function imageKind(bytes: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return null
}

const PROMPT = () => `You are reading a trading chart screenshot for educational analysis.
Describe ONLY what is visible. Do NOT give entry, stop loss or take profit prices. Do not promise outcomes.
Read the pair and timeframe from the chart labels. Use the ones you see, not guesses.

Return ONLY this JSON object, no other text:
{"symbol":"pair from the chart, like EURUSD, or unknown","timeframe":"like H1, or unknown","bias":"bullish"|"bearish"|"neutral"|"unclear","structure":"one or two sentences on the trend and recent swings","pattern":"what setup, if any, is visible, or 'none clear'","observed_levels":"notable price areas you can see, described in words, or 'not readable'","what_would_change_it":"what price action would invalidate this read","confidence":0.0-1.0,"caveats":"what you cannot tell from a screenshot"}`

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  try {
    const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', ''))
    if (!user) return res.status(401).json({ error: 'Please sign in again.' })
    const { sb } = env(), h = dbHeaders()
    if (!process.env.NVIDIA_API_KEY) return res.status(500).json({ error: 'NVIDIA_API_KEY is not set in Vercel. Add it as a Secret and redeploy.' })

    // who may use it: admin, or a member with an active plan
    const prof = (await (await fetch(`${sb}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: h })).json()) as { role: string }[]
    const sub = (await (await fetch(`${sb}/rest/v1/subscriptions?user_id=eq.${user.id}&select=plan,expires_at`, { headers: h })).json()) as { plan: string; expires_at: string }[]
    const allowed = prof[0]?.role === 'admin' || (sub[0] && new Date(sub[0].expires_at).getTime() > Date.now())
    if (!allowed) return res.status(403).json({ error: 'Chart reading needs an active plan.' })

    // the member must have switched the tool on
    const us = (await (await fetch(`${sb}/rest/v1/user_settings?user_id=eq.${user.id}&select=data`, { headers: h })).json()) as { data: Record<string, unknown> }[]
    if (us[0]?.data?.chart_read_on !== true) return res.status(403).json({ error: 'Switch on Chart reading in the Bot tab first.' })

    // image checks
    const raw = String(req.body?.image ?? '')
    const m = raw.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/)
    if (!m) return res.status(400).json({ error: 'Upload a PNG, JPEG or WEBP screenshot.' })
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'Screenshot is over 2 MB. Crop it or take a smaller one.' })
    const kind = imageKind(bytes)
    if (!kind) return res.status(400).json({ error: 'That file is not a real PNG, JPEG or WEBP image.' })

    // daily limit, counted from saved reads
    const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0)
    const today = (await (await fetch(`${sb}/rest/v1/chart_reads?user_id=eq.${user.id}&created_at=gte.${midnight.toISOString()}&select=id`, { headers: h })).json()) as unknown[]
    if (Array.isArray(today) && today.length >= DAILY_LIMIT) return res.status(429).json({ error: `Daily limit of ${DAILY_LIMIT} chart reads reached. It resets at midnight UTC.` })

    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 700, temperature: 0.1,
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT() },
          { type: 'image_url', image_url: { url: `data:image/${kind};base64,${m[2]}` } },
        ] }],
      }),
      signal: AbortSignal.timeout(45000),
    })
    if (!r.ok) return res.status(502).json({ error: `The chart reader could not answer (${r.status}). Try again shortly.` })
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const text = j.choices?.[0]?.message?.content ?? ''
    const start = text.indexOf('{'), end = text.lastIndexOf('}') + 1
    let read: Record<string, unknown>
    try { read = JSON.parse(text.slice(start, end)) } catch { return res.status(502).json({ error: 'The chart reader answered in an unexpected format. Nothing was saved. Try again.' }) }
    read.confidence = Math.max(0, Math.min(1, Number(read.confidence) || 0))
    const symbol = PAIRS.includes(String(read.symbol ?? '').toUpperCase()) ? String(read.symbol).toUpperCase() : 'unknown'
    const timeframe = TIMEFRAMES.includes(String(read.timeframe ?? '').toUpperCase()) ? String(read.timeframe).toUpperCase() : null

    // our own numbers for the pair the model read off the chart, for reference only
    let ref = 'Pair not recognised on the chart, so no live reference is shown.'
    if (symbol !== 'unknown') {
      const mk = (await (await fetch(`${sb}/rest/v1/market_state?symbol=eq.${symbol}&select=trend,price,ema50,atr,updated_at`, { headers: h })).json()) as Record<string, unknown>[]
      ref = mk[0]
        ? `${symbol} last price ${mk[0].price}, EMA50 ${mk[0].ema50}, ATR ${mk[0].atr}, trend ${mk[0].trend} (as of ${mk[0].updated_at}).`
        : `No live market reading for ${symbol} is available right now.`
    }

    // save the text read only, never the image
    await fetch(`${sb}/rest/v1/chart_reads`, { method: 'POST', headers: h, body: JSON.stringify({ user_id: user.id, symbol, timeframe: timeframe ?? '?', read }) })
    return res.status(200).json({ ok: true, symbol, timeframe: timeframe ?? '?', reference: ref, read, disclaimer: 'An opinion from a screenshot. Not a signal, not a trade, and not tested. Trade levels come only from our scanner.' })
  } catch (e) {
    return res.status(500).json({ error: `The server hit an error: ${(e as Error).message}` })
  }
}
