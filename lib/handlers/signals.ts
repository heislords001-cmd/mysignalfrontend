// GET /api/signals: the latest approved signals, for members with an active plan. Untested signals are never returned.
import { dbHeaders, env, userFromJwt } from '../_auth.js'
import { hashKey } from './signals-key.js'

interface Req { method?: string; headers: Record<string, string | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 15 }

export default async function handler(req: Req & { query?: Record<string, unknown>; url?: string }, res: Res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' })
  const bearer = (req.headers.authorization ?? '').replace('Bearer ', '').trim()
  const q0 = (req.query ?? {}) as Record<string, unknown>
  const keyFromUrl = String(q0.key ?? new URL(req.url ?? '/', 'http://x').searchParams.get('key') ?? '')
  const apiKey = (process.env.SIGNALS_API_KEY ?? '').trim()
  // the shared API key (set in Vercel as SIGNALS_API_KEY) never expires; a member's sign-in token expires after about an hour
  const usingKey = !!apiKey && (bearer === apiKey || keyFromUrl === apiKey)
  const { sb } = env(), h = dbHeaders()
  // a member's own key: only its hash is stored, so look the hash up
  let memberId: string | null = null
  if (!usingKey && bearer.startsWith('fxd_')) {
    const hits = (await (await fetch(`${sb}/rest/v1/user_settings?data->>signals_key_hash=eq.${hashKey(bearer)}&select=user_id`, { headers: h })).json()) as { user_id: string }[]
    memberId = hits[0]?.user_id ?? null
    if (!memberId) return res.status(401).json({ error: 'That key is not valid. Create a new one on the Profile tab.' })
  }
  if (!usingKey) {
    const user = memberId ? { id: memberId } : await userFromJwt(bearer)
    if (!user) return res.status(401).json({ error: 'Send your API key or your sign-in token as Authorization: Bearer <value>.' })
    const sub = (await (await fetch(`${sb}/rest/v1/subscriptions?user_id=eq.${user.id}&select=expires_at`, { headers: h })).json()) as { expires_at: string }[]
    const prof = (await (await fetch(`${sb}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: h })).json()) as { role: string }[]
    const active = prof[0]?.role === 'admin' || (sub[0] && new Date(sub[0].expires_at).getTime() > Date.now())
    if (!active) return res.status(403).json({ error: 'Signals need an active plan.' })
  }
  // ?approved_only=1 returns just the signals that passed the test. By default untested signals are included, each marked approved: false.
  const q = (req.query ?? {}) as Record<string, unknown>
  const onlyApproved = String(q.approved_only ?? new URL(req.url ?? '/', 'http://x').searchParams.get('approved_only') ?? '') === '1'
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const filter = onlyApproved ? 'approved=eq.true&' : ''
  const rows = (await (await fetch(
    `${sb}/rest/v1/signals?${filter}created_at=gte.${since}&select=symbol,side,timeframe,strategy,entry,sl,tp1,tp2,approved,agreement,risk_warning,expires_at,created_at&order=created_at.desc&limit=30`,
    { headers: h })).json()) as Record<string, unknown>[]
  return res.status(200).json({ ok: true, count: rows.length, signals: rows,
    note: 'approved: true means the strategy passed the test. approved: false means it is untested, and past untested signals have lost money. Size stops and targets to your own account.' })
}
