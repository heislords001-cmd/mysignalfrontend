// A member makes their own signals key on the Profile page. The key is shown once; only its hash is stored.
// POST with the member's sign-in token and {"action":"new"} or {"action":"revoke"}.
import { createHash, randomBytes } from 'node:crypto'
import { dbHeaders, env, userFromJwt } from '../_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 15 }

export const hashKey = (k: string) => createHash('sha256').update(k).digest('hex')

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', '').trim())
  if (!user) return res.status(401).json({ error: 'Sign in first.' })
  const { sb } = env(), h = dbHeaders()
  const action = String(((req.body ?? {}) as { action?: string }).action ?? 'new')
  const cur = (await (await fetch(`${sb}/rest/v1/user_settings?user_id=eq.${user.id}&select=data`, { headers: h })).json()) as { data: Record<string, unknown> }[]
  const data = { ...(cur[0]?.data ?? {}) } as Record<string, unknown>
  if (action === 'revoke') {
    delete data.signals_key_hash
    await fetch(`${sb}/rest/v1/user_settings?on_conflict=user_id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: user.id, data }) })
    return res.status(200).json({ ok: true, note: 'Your signals key is revoked. Create a new one if you need it.' })
  }
  const key = 'fxd_' + randomBytes(24).toString('hex')
  data.signals_key_hash = hashKey(key)
  await fetch(`${sb}/rest/v1/user_settings?on_conflict=user_id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: user.id, data }) })
  return res.status(200).json({ ok: true, key, note: 'Copy this key now. It is shown only once. Creating a new key replaces this one.' })
}
