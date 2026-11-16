// Vercel function. Supabase calls it every time the scanner saves a signal (Database Webhook on INSERT into signals).
import { timingSafeEqual } from 'node:crypto'
import { executeSignal } from './_execute'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { type?: string; table?: string; record?: any } }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

export default async function handler(req: Req, res: Res) {
  const want = process.env.WEBHOOK_SECRET
  if (!want) return res.status(500).json({ error: 'WEBHOOK_SECRET is not set on the server.' })
  const got = (req.headers.authorization ?? '').replace('Bearer ', '')
  const a = Buffer.from(got), b = Buffer.from(want)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'Not allowed.' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const rec = req.body?.record
  if (req.body?.type !== 'INSERT' || req.body?.table !== 'signals' || !rec) return res.status(200).json({ ok: true, ignored: true })
  const result = await executeSignal({ id: rec.id, symbol: rec.symbol, side: rec.side, entry: Number(rec.entry), sl: Number(rec.sl), tp1: Number(rec.tp1), approved: rec.approved, expires_at: rec.expires_at })
  return res.status(200).json({ ok: true, ...result })
}
