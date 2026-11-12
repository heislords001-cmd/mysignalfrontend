// Vercel function. Supabase calls it every time the scanner saves a signal (Database Webhook on INSERT into signals).
import { executeSignal } from '../_execute.js'
import { checkHook } from '../_hook.js'
import { askModel } from '../_ai.js'
import { dbHeaders, env } from '../_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { type?: string; table?: string; record?: any } }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

export default async function handler(req: Req, res: Res) {
  const gate = checkHook(req.headers)
  if (gate === 'not_set') return res.status(500).json({ error: 'WEBHOOK_SECRET is not set on the server.' })
  if (gate === 'denied') return res.status(401).json({ error: 'Not allowed.' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const rec = req.body?.record
  if (req.body?.type !== 'INSERT' || req.body?.table !== 'signals' || !rec) return res.status(200).json({ ok: true, ignored: true })
  const sig = { id: rec.id, symbol: rec.symbol, side: rec.side, entry: Number(rec.entry), sl: Number(rec.sl), tp1: Number(rec.tp1), approved: rec.approved, expires_at: rec.expires_at }
  // trades and the AI note run side by side: a slow or failed model call never delays or blocks a trade
  const [result, note] = await Promise.allSettled([executeSignal(sig), annotate(sig)])
  return res.status(200).json({ ok: true, ...(result.status === 'fulfilled' ? result.value : { error: 'trade step failed' }), note: note.status === 'fulfilled' ? note.value : null })
}

// Writes a short plain-English note onto the signal. It does NOT change the levels or create trades.
async function annotate(s: { id: number; symbol: string; side: string; entry: number; sl: number; tp1: number }): Promise<string | null> {
  const prompt = `You are writing a short note for a forex signal card. Two sentences at most, plain English, no advice to trade.
Signal: ${s.side.toUpperCase()} ${s.symbol} entry ${s.entry}, stop ${s.sl}, target ${s.tp1}.
Say what the setup is trying to do and the main risk. Do not change or repeat the numbers as new advice.`
  const text = await askModel(prompt)
  if (!text) return null
  const { sb } = env()
  await fetch(`${sb}/rest/v1/signals?id=eq.${s.id}`, { method: 'PATCH', headers: { ...dbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ ai_note: text }) })
  return text
}
