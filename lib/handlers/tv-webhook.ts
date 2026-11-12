// TradingView webhook receiver.
// In TradingView: Alerts > Webhook URL = https://YOUR-SITE.vercel.app/api/tv-webhook
// Alert message (JSON format):
// {"symbol":"EURUSD","side":"buy","entry":{{close}},"sl":{{low}},"tp1":{{high}},"timeframe":"{{interval}}","secret":"YOUR_WEBHOOK_SECRET"}
// This saves the alert as a signal straight to Supabase, bypassing the scanner,
// so you get TradingView's exact price feeds and indicators on your site.
import { checkHook } from '../_hook.js'
import { dbHeaders, env } from '../_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: any }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 10 }

const REQUIRED = ['symbol', 'side', 'entry', 'sl', 'tp1'] as const
const PAIRS: Record<string, boolean> = { EURUSD: true, USDCHF: true, USDCAD: true, USDJPY: true, AUDUSD: true, XAUUSD: true }

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  // TradingView sends the secret in the body, not as a header
  const body = req.body ?? {}
  const secret = String(body.secret ?? '')
  const want = process.env.WEBHOOK_SECRET ?? ''
  if (!want) return res.status(500).json({ error: 'WEBHOOK_SECRET not set.' })
  if (secret.length !== want.length || Buffer.from(secret).compare(Buffer.from(want)) !== 0)
    return res.status(401).json({ error: 'Bad secret.' })
  for (const k of REQUIRED) {
    if (body[k] === undefined || body[k] === null || body[k] === '') return res.status(400).json({ error: `Missing field: ${k}` })
  }
  const symbol = String(body.symbol).toUpperCase().replace('FX:', '').replace('OANDA:', '').replace(/USD$/, 'USD')
  if (!PAIRS[symbol]) return res.status(400).json({ error: `Unsupported symbol: ${symbol}. Supported: ${Object.keys(PAIRS).join(', ')}` })
  const side = String(body.side).toLowerCase()
  if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'side must be buy or sell.' })
  const entry = Number(body.entry), sl = Number(body.sl), tp1 = Number(body.tp1)
  if ([entry, sl, tp1].some((x) => !Number.isFinite(x) || x <= 0)) return res.status(400).json({ error: 'entry, sl and tp1 must be positive numbers.' })
  const { sb } = env(), h = { ...dbHeaders(), Prefer: 'resolution=merge-duplicates' }
  const bar_time = body.bar_time ?? new Date().toISOString()
  const signal = {
    symbol, side, entry, sl, tp1,
    tp2: tp1,                                    // TV alerts usually give one target; tp2 defaults to the same
    timeframe: String(body.timeframe ?? 'TV'),
    strategy: 'tradingview',
    bar_time, approved: true,
    max_hold_min: Number(body.hold_min ?? 240),
    source: 'tradingview',
  }
  const r = await fetch(`${sb}/rest/v1/signals?on_conflict=symbol,side,timeframe,strategy,bar_time`, { method: 'POST', headers: h, body: JSON.stringify(signal) })
  if (!r.ok) { const t = await r.text(); return res.status(500).json({ error: `Could not save signal: ${t.slice(0, 200)}` }) }
  return res.status(200).json({ ok: true, symbol, side, entry })
}
