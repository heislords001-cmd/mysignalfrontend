// Optional chart reading. A member uploads a chart screenshot; a vision model describes what it sees.
// It is an OPINION, never a signal: it does not create signals, executions or trades.
// Trade levels come only from our own market data (market_state), shown next to the read for reference.
// The image is used for the one request and is NOT stored. Only the text read is saved.
import { dbHeaders, env, userFromJwt } from '../_auth.js'
import { askVision } from '../_ai.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { image?: string } }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

const PAIRS = ['EURUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'AUDUSD', 'XAUUSD']
const TIMEFRAMES = ['M5', 'M15', 'H1', 'H4', 'D1']
const MAX_BYTES = 2 * 1024 * 1024
const DAILY_LIMIT = 10

// Checks the real file type from its first bytes, not just the text the browser sends
function imageKind(bytes: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return null
}

const PROMPT = () => `Describe this trading chart screenshot. Report only what is visible on it. No opinions, no advice, no predictions, no entry, stop loss or take profit prices.
Read the pair and timeframe from the chart labels. Use "unknown" if they are not shown.

Return ONLY this JSON object, no other text:
{"symbol":"pair shown, like EURUSD, or unknown","timeframe":"like H1, or unknown","visible_trend":"up" or "down" or "sideways" or "unclear","candles":"what the last visible candles do, in plain words","swing_points":"the visible highs and lows and where they are, in plain words","visible_levels":"horizontal price areas visible on the chart, in plain words","possible_setup":"buy" or "sell" or "none","setup_condition":"the visible condition that makes it a possible buy or sell, or 'none'","not_visible":"what this chart does not show"}` + ""

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

    const ai = await askVision(PROMPT(), `data:image/${kind};base64,${m[2]}`)
    if (!ai.ok) return res.status(502).json({ error: `The chart reader could not answer (status ${ai.status ?? 'none'}, model ${ai.model || 'not set'}). ${ai.detail}`.trim() })
    const text = ai.text
    const start = text.indexOf('{'), end = text.lastIndexOf('}') + 1
    let read: Record<string, unknown>
    try { read = JSON.parse(text.slice(start, end)) } catch { return res.status(502).json({ error: 'The chart reader answered in an unexpected format. Nothing was saved. Try again.' }) }
    const symbol = PAIRS.includes(String(read.symbol ?? '').toUpperCase()) ? String(read.symbol).toUpperCase() : 'unknown'
    const timeframe = TIMEFRAMES.includes(String(read.timeframe ?? '').toUpperCase()) ? String(read.timeframe).toUpperCase() : null

    // our own numbers for the pair the model read off the chart, for reference only
    let ref = 'Pair not recognised on the chart, so no live data is shown.'
    let setup: Record<string, unknown> | null = null
    if (symbol !== 'unknown') {
      const mk = (await (await fetch(`${sb}/rest/v1/market_state?symbol=eq.${symbol}&select=trend,price,ema50,atr,updated_at`, { headers: h })).json()) as Record<string, unknown>[]
      const row = mk[0]
      ref = row ? `${symbol} last price ${row.price}, EMA50 ${row.ema50}, ATR ${row.atr} (as of ${row.updated_at}).` : `No live market data for ${symbol} is available right now.`
      const side = String(read.possible_setup ?? '').toLowerCase()
      const p = Number(row?.price), a = Number(row?.atr)
      if (row && (side === 'buy' || side === 'sell') && p > 0 && a > 0) {
        // levels come from OUR live price and ATR, never from the picture. Stop 1.5 ATR, targets at 1.5R and 3R.
        const d = side === 'buy' ? 1 : -1
        const risk = 1.5 * a
        setup = {
          side,
          entry: Number(p.toFixed(5)),
          stop_loss: Number((p - d * risk).toFixed(5)),
          take_profit_1: Number((p + d * 1.5 * risk).toFixed(5)),
          take_profit_2: Number((p + d * 3 * risk).toFixed(5)),
          basis: 'Calculated from our live price and ATR, not read from the picture. Untested. Not a signal.',
        }
      }
    }

    // save the text read only, never the image
    await fetch(`${sb}/rest/v1/chart_reads`, { method: 'POST', headers: h, body: JSON.stringify({ user_id: user.id, symbol, timeframe: timeframe ?? '?', read }) })
    return res.status(200).json({ ok: true, symbol, timeframe: timeframe ?? '?', reference: ref, read, setup, disclaimer: 'Describes what is on the chart. A possible setup is not a signal and has not been tested.' })
  } catch (e) {
    return res.status(500).json({ error: `The server hit an error: ${(e as Error).message}` })
  }
}
