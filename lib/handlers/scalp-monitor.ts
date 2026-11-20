// Every 15 seconds the scalp run sends the latest plans here. This closes positions that reached the profit or the stop,
// and opens the next position for members who still have room. The secret is required.
import { activeMemberIds, openScalpFor, checkScalpOrder } from '../_execute.js'
import { monitorMember } from '../_scalp_monitor.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

type Plan = { side: 'buy' | 'sell'; entry: number; sl: number; tp1: number; updated_at: string; symbol: string } | null

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const secret = (process.env.WEBHOOK_SECRET ?? '').trim()
  if (!secret || (req.headers.authorization ?? '') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Not allowed.' })
  const plans = ((req.body ?? {}) as { plans?: Record<string, Plan> }).plans ?? {}
  const sides: Record<string, { side: 'buy' | 'sell' } | null> = {}
  for (const [sym, p] of Object.entries(plans)) {
    sides[sym] = p && !checkScalpOrder({ ...p, symbol: sym } as any) ? { side: p.side } : null
  }
  const report: Record<string, unknown> = {}
  try {
    for (const id of await activeMemberIds()) {
      const r = await monitorMember(id, sides)
      const opened: unknown[] = []
      for (const o of r.opens) {
        const p = plans[o.symbol]
        if (!p) continue
        // one key per member, per pair, per 15-second check: a repeated call can never open the same position twice
        const key = `scalp-open:${o.symbol}:${p.updated_at}:${Math.floor(Date.now() / 15000)}:${id}`
        opened.push(await openScalpFor({ ...p, symbol: o.symbol, side: o.side }, id, key))
      }
      report[id.slice(0, 8)] = { closed: r.closed, failed: r.failed, opened: opened.length, note: r.note ?? null }
    }
    return res.status(200).json({ ok: true, report })
  } catch (e) {
    return res.status(500).json({ error: `The monitor hit an error: ${(e as Error).message}` })
  }
}
