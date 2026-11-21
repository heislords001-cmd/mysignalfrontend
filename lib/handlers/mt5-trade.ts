import { freeAccess } from '../_free.js'
// The MT5 Expert Advisor reports each trade here: when it opens, and when it closes. Authenticated with the member's signals key.
import { dbHeaders, env } from '../_auth.js'
import { hashKey } from './signals-key.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 15 }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function reportMt5Trade(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const key = (req.headers.authorization ?? '').replace('Bearer ', '').trim()
  if (!key.startsWith('fxd_')) return res.status(401).json({ error: 'Send your signals key as Authorization: Bearer <key>.' })
  const { sb } = env(), h = dbHeaders()
  const hits = (await (await fetch(`${sb}/rest/v1/user_settings?data->>signals_key_hash=eq.${hashKey(key)}&select=user_id`, { headers: h })).json()) as { user_id: string }[]
  const userId = hits[0]?.user_id
  if (!userId) return res.status(401).json({ error: 'That key is not valid.' })
  const sub = (await (await fetch(`${sb}/rest/v1/subscriptions?user_id=eq.${userId}&select=expires_at`, { headers: h })).json()) as { expires_at: string }[]
  if (!(await freeAccess()) && !(sub[0] && new Date(sub[0].expires_at).getTime() > Date.now())) return res.status(403).json({ error: 'Your plan is not active.' })

  const b = (req.body ?? {}) as Record<string, unknown>
  const side = b.side === 'buy' || b.side === 'sell' ? b.side : null
  const status = b.status === 'open' || b.status === 'closed' ? b.status : null
  const ticket = num(b.ticket)
  const symbol = typeof b.symbol === 'string' && /^[A-Z0-9._-]{2,12}$/.test(b.symbol) ? b.symbol : null
  const account = typeof b.account === 'string' && b.account.length <= 30 ? b.account : null
  if (!side || !status || !ticket || ticket <= 0 || !symbol || !account) return res.status(400).json({ error: 'Missing or wrong fields: account, ticket, symbol, side, status.' })

  // only fields that were sent are written, so a close report keeps the open report's stop, target and strategy
  const row: Record<string, unknown> = { user_id: userId, account, ticket, symbol, side, status }
  const optional: Record<string, unknown> = {
    lots: num(b.lots), entry: num(b.entry), sl: num(b.sl), tp: num(b.tp), profit: num(b.profit),
    strategy: typeof b.strategy === 'string' ? b.strategy.slice(0, 40) : null,
    opened_at: typeof b.opened_at === 'string' ? b.opened_at : null,
    closed_at: typeof b.closed_at === 'string' ? b.closed_at : null,
  }
  for (const [k, v] of Object.entries(optional)) if (v !== null) row[k] = v

  const up = await fetch(`${sb}/rest/v1/mt5_trades?on_conflict=user_id,account,ticket`, {
    method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]),
  })
  if (!up.ok) return res.status(502).json({ error: `The trade could not be saved (status ${up.status}).` })
  return res.status(200).json({ ok: true, status, ticket })
}
