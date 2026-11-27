// Admin only: how many members are on the site, how many are paying, how many are receiving signals, and whether the scanner is running.
import { dbHeaders, env, userFromJwt } from '../_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }

export async function membersStats(req: Req, res: Res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' })
  const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', '').trim())
  if (!user) return res.status(401).json({ error: 'Sign in first.' })
  const { sb } = env(), h = dbHeaders()
  const prof = (await (await fetch(`${sb}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: h })).json()) as { role: string }[]
  if (prof[0]?.role !== 'admin') return res.status(403).json({ error: 'Admins only.' })

  const count = async (path: string): Promise<number> => {
    const r = await fetch(`${sb}/rest/v1/${path}`, { headers: { ...h, Prefer: 'count=exact', Range: '0-0' } })
    return Number((r.headers.get('content-range') ?? '').split('/')[1]) || 0
  }
  const now = new Date().toISOString()
  const [total, paying, receiving] = await Promise.all([
    count('profiles?select=id'),
    count(`subscriptions?select=user_id&expires_at=gt.${encodeURIComponent(now)}`),
    count('user_settings?select=user_id&data->>signals_on=eq.true'),
  ])
  const st = (await (await fetch(`${sb}/rest/v1/scanner_state?id=eq.1&select=running`, { headers: h })).json()) as { running: boolean }[]
  return res.status(200).json({ ok: true, total_members: total, paying_active: paying, receiving_signals: receiving, scanner_running: !!st[0]?.running })
}
