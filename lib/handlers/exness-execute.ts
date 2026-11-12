// Webhook receiver: when a signal is saved, place trades on Exness accounts.
import { checkHook } from '../_hook.js'
import { dbHeaders, env } from '../_auth.js'
import { exnessConfigured, placeOrder } from '../_exness.js'
import { SYMBOLS } from '../_trade.js'
import { planTrade } from '../_trade.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: any }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

// MT5 lot sizing from signal price levels
function calcVolume(entry: number, sl: number, stake: number, multiplier = 100): number {
  const pips = Math.abs(entry - sl) * (entry < 50 ? 1 : 10000)
  const pipValue = (stake * 0.5) / Math.max(pips, 0.1)
  const lots = Math.round(pipValue / 10 * 100) / 100
  return Math.min(1.0, Math.max(0.01, lots))
}

export default async function handler(req: Req, res: Res) {
  const gate = checkHook(req.headers)
  if (gate === 'not_set') return res.status(500).json({ error: 'WEBHOOK_SECRET not set.' })
  if (gate === 'denied')  return res.status(401).json({ error: 'Not allowed.' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const rec = req.body?.record
  if (req.body?.type !== 'INSERT' || req.body?.table !== 'signals' || !rec) return res.status(200).json({ ok: true, ignored: true })
  if (!exnessConfigured()) return res.status(200).json({ ok: true, note: 'Exness not configured.' })

  const { sb } = env(), h = dbHeaders()
  // Find members who use Exness, have bot on, and have an auto plan
  const on = (await (await fetch(`${sb}/rest/v1/bot_state?bot_on=eq.true&select=user_id`, { headers: h })).json()) as { user_id: string }[]
  if (!on.length) return res.status(200).json({ ok: true, note: 'No members with bot on.' })
  const ids = on.map((r) => r.user_id).join(',')
  const links = (await (await fetch(`${sb}/rest/v1/broker_links?user_id=in.(${ids})&broker=eq.exness&status=eq.verified&select=user_id,loginid,is_virtual`, { headers: h })).json()) as { user_id: string; loginid: string; is_virtual: boolean }[]
  if (!links.length) return res.status(200).json({ ok: true, note: 'No Exness-linked members.' })

  const symbol = rec.symbol?.replace('USD', 'USD') ?? ''
  const side   = rec.side as 'buy' | 'sell'
  const entry  = Number(rec.entry), sl = Number(rec.sl), tp1 = Number(rec.tp1)
  if (!symbol || !['buy','sell'].includes(side) || isNaN(entry) || isNaN(sl)) return res.status(200).json({ ok: true, note: 'Invalid signal fields.' })

  let bought = 0, failed = 0
  for (const link of links) {
    if (!link.is_virtual) continue    // demo only for now
    const volume = calcVolume(entry, sl, 1)
    const r = await placeOrder({ accountId: link.loginid, symbol, side, volume, stopLoss: sl, takeProfit: tp1, comment: `sig:${rec.id}` })
    r.ok ? bought++ : failed++
    // record in executions
    await fetch(`${sb}/rest/v1/executions`, { method: 'POST', headers: { ...h, Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ user_id: link.user_id, signal_id: rec.id, kind: 'signal', symbol, side, dedupe_key: `exness:${link.user_id}:${rec.id}`, status: r.ok ? 'bought' : 'failed', message: r.ok ? `Exness ${side} ${volume} lots` : (r as any).message?.slice(0, 200) }) })
  }
  return res.status(200).json({ ok: true, bought, failed })
}
