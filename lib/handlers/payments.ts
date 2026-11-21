// The admin's payment switch. GET: anyone reads it. POST (admin only): turns payments on or off.
// Turning payments ON gives every existing account a free subscription first, so nobody is charged for having joined earlier.
import { dbHeaders, env, userFromJwt } from '../_auth.js'
import { clearFreeCache, freeAccess } from '../_free.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

export async function paymentsSwitch(req: Req, res: Res) {
  const { sb } = env(), h = dbHeaders()
  if (req.method === 'GET') return res.status(200).json({ ok: true, payments_on: !(await freeAccess()) })
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET to read, POST to switch.' })
  const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', '').trim())
  if (!user) return res.status(401).json({ error: 'Sign in first.' })
  const prof = (await (await fetch(`${sb}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: h })).json()) as { role: string }[]
  if (prof[0]?.role !== 'admin') return res.status(403).json({ error: 'Only the admin can change payments.' })
  const on = (req.body as { on?: unknown } | undefined)?.on === true

  let grandfathered = 0
  if (on) {
    // everyone who already has an account keeps full access when payments start
    const everyone = (await (await fetch(`${sb}/rest/v1/profiles?select=id`, { headers: h })).json()) as { id: string }[]
    const subbed = (await (await fetch(`${sb}/rest/v1/subscriptions?select=user_id`, { headers: h })).json()) as { user_id: string }[]
    const have = new Set(subbed.map((r) => r.user_id))
    const missing = everyone.filter((p) => !have.has(p.id)).map((p) => ({ user_id: p.id, plan: 'auto', expires_at: '2099-12-31T00:00:00Z' }))
    if (missing.length) {
      await fetch(`${sb}/rest/v1/subscriptions?on_conflict=user_id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(missing) })
    }
    grandfathered = missing.length
  }

  const cur = (await (await fetch(`${sb}/rest/v1/settings?id=eq.1&select=data`, { headers: h })).json()) as { data?: Record<string, unknown> }[]
  const data = { ...(cur[0]?.data ?? {}), payments_on: on }
  const save = await fetch(`${sb}/rest/v1/settings?on_conflict=id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ id: 1, data }]) })
  if (!save.ok) return res.status(502).json({ error: `Could not save the switch (status ${save.status}).` })
  clearFreeCache()
  return res.status(200).json({ ok: true, payments_on: on, grandfathered,
    note: on ? `Payments are on. ${grandfathered} existing account(s) kept their free access.` : 'Payments are off. Everyone has free access.' })
}
