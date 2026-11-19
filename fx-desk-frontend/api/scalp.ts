// Vercel function for SCALP mode. Supabase calls it every time the scanner refreshes a pair in market_state
// (Database Webhook on INSERT and UPDATE of market_state).
import { executeScalp } from './_execute.js'
import { checkHook } from './_hook.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { type?: string; table?: string; record?: any } }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

export default async function handler(req: Req, res: Res) {
  const gate = checkHook(req.headers)
  if (gate === 'not_set') return res.status(500).json({ error: 'WEBHOOK_SECRET is not set on the server.' })
  if (gate === 'denied') return res.status(401).json({ error: 'Not allowed.' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const rec = req.body?.record
  if (!['INSERT', 'UPDATE'].includes(req.body?.type ?? '') || req.body?.table !== 'market_state' || !rec) return res.status(200).json({ ok: true, ignored: true })
  const result = await executeScalp({ symbol: rec.symbol, trend: rec.trend, price: Number(rec.price), ema50: Number(rec.ema50), atr: Number(rec.atr), updated_at: rec.updated_at })
  return res.status(200).json({ ok: true, ...result })
}
