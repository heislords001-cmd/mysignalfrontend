// The pairs a member wants the EA on. GET: read them (sign-in token or signals key). POST: save them (sign-in token).
import { dbHeaders, env, userFromJwt } from '../_auth.js'
import { hashKey } from './signals-key.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 15 }

export const EA_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'XAUUSD']
export const MAX_EA_PAIRS = 8

export async function eaConfig(req: Req, res: Res) {
  const bearer = (req.headers.authorization ?? '').replace('Bearer ', '').trim()
  const { sb } = env(), h = dbHeaders()
  let userId: string | null = null
  if (bearer.startsWith('fxd_')) {
    const hits = (await (await fetch(`${sb}/rest/v1/user_settings?data->>signals_key_hash=eq.${hashKey(bearer)}&select=user_id`, { headers: h })).json()) as { user_id: string }[]
    userId = hits[0]?.user_id ?? null
  } else {
    userId = (await userFromJwt(bearer))?.id ?? null
  }
  if (!userId) return res.status(401).json({ error: 'Sign in, or send your signals key.' })

  const cur = (await (await fetch(`${sb}/rest/v1/user_settings?user_id=eq.${userId}&select=data`, { headers: h })).json()) as { data: Record<string, unknown> }[]
  const data = { ...(cur[0]?.data ?? {}) } as Record<string, unknown>

  if (req.method === 'GET') {
    const pairs = Array.isArray(data.ea_pairs) ? (data.ea_pairs as string[]).filter((p) => EA_PAIRS.includes(p)) : []
    return res.status(200).json({ ok: true, pairs, available: EA_PAIRS })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET to read, POST to save.' })
  if (bearer.startsWith('fxd_')) return res.status(403).json({ error: 'Pick your pairs on the website, signed in.' })

  const body = (req.body ?? {}) as { pairs?: unknown }
  const pairs = Array.isArray(body.pairs) ? [...new Set(body.pairs.map(String))] : []
  if (pairs.some((p) => !EA_PAIRS.includes(p))) return res.status(400).json({ error: 'That pair is not available for the EA.' })
  if (pairs.length > MAX_EA_PAIRS) return res.status(400).json({ error: `Pick at most ${MAX_EA_PAIRS} pairs.` })
  data.ea_pairs = pairs
  await fetch(`${sb}/rest/v1/user_settings?on_conflict=user_id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: userId, data }) })
  return res.status(200).json({ ok: true, pairs, note: 'Saved. The VPS picks this up on its next check.' })
}
