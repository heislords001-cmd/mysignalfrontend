// A member's MT5 demo login. The password is encrypted before it is stored, and it is never sent back to the site.
import { encrypt } from '../_crypto.js'
import { dbHeaders, env, userFromJwt } from '../_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 15 }

export async function mt5Account(req: Req, res: Res) {
  const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', '').trim())
  if (!user) return res.status(401).json({ error: 'Sign in first.' })
  const { sb } = env(), h = dbHeaders()
  const sub = (await (await fetch(`${sb}/rest/v1/subscriptions?user_id=eq.${user.id}&select=expires_at`, { headers: h })).json()) as { expires_at: string }[]
  const prof = (await (await fetch(`${sb}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: h })).json()) as { role: string }[]
  const active = prof[0]?.role === 'admin' || (sub[0] && new Date(sub[0].expires_at).getTime() > Date.now())
  if (!active) return res.status(403).json({ error: 'The EA needs an active plan.' })

  if (req.method === 'GET') {
    const rows = (await (await fetch(`${sb}/rest/v1/mt5_accounts?user_id=eq.${user.id}&select=login,server,status,note,updated_at`, { headers: h })).json()) as Record<string, unknown>[]
    return res.status(200).json({ ok: true, account: rows[0] ?? null })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only.' })

  const b = (req.body ?? {}) as Record<string, unknown>
  const login = typeof b.login === 'string' ? b.login.trim() : ''
  const server = typeof b.server === 'string' ? b.server.trim() : ''
  const password = typeof b.password === 'string' ? b.password : ''
  if (!/^\d{4,12}$/.test(login)) return res.status(400).json({ error: 'The MT5 login is a number of 4 to 12 digits.' })
  if (server.length < 3 || server.length > 60) return res.status(400).json({ error: 'Enter the broker server name, for example ExampleBroker-Demo.' })
  if (password.length < 4 || password.length > 100) return res.status(400).json({ error: 'Enter the MT5 password.' })

  const row = { user_id: user.id, login, server, password_enc: encrypt(password), status: 'pending', note: 'Saved. Waiting for the VPS to log in.', updated_at: new Date().toISOString() }
  const up = await fetch(`${sb}/rest/v1/mt5_accounts?on_conflict=user_id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]) })
  if (!up.ok) return res.status(502).json({ error: `Could not save (status ${up.status}). Make sure migration-13 has been run.` })
  return res.status(200).json({ ok: true, note: 'Saved. The VPS will log in to this account.' })
}
