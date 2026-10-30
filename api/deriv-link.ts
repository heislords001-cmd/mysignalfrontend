// Vercel function: saves (POST) or removes (DELETE) a member's Deriv API key. The key is encrypted before it is stored
// and is never sent back to the browser.
import { encrypt } from './_crypto.js'
import { derivAuthorize } from './_deriv.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { token?: string } }
interface Res { status(c: number): Res; json(b: unknown): void }

export default async function handler(req: Req, res: Res) {
  try { return await run(req, res) } catch (e) { return res.status(500).json({ error: `The server hit an error: ${(e as Error).message}` }) }
}

async function run(req: Req, res: Res) {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'TOKEN_ENCRYPTION_KEY'].filter((k) => !process.env[k])
  if (missing.length) return res.status(500).json({ error: `A server setting is missing in Vercel: ${missing.join(', ')}. Add it as a Secret, then press Redeploy.` })
  const jwt = (req.headers.authorization ?? '').replace('Bearer ', '')
  if (!jwt) return res.status(401).json({ error: 'Please sign in again.' })
  const sb = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_KEY!
  const db = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

  const u = await fetch(`${sb}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } })
  if (!u.ok) return res.status(401).json({ error: 'Please sign in again.' })
  const user = (await u.json()) as { id: string }

  // only admins and members with an active Auto-trading plan may save a key
  const prof = (await (await fetch(`${sb}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: db })).json()) as { role: string }[]
  const sub = (await (await fetch(`${sb}/rest/v1/subscriptions?user_id=eq.${user.id}&select=plan,expires_at`, { headers: db })).json()) as { plan: string; expires_at: string }[]
  const allowed = prof[0]?.role === 'admin' || (sub[0]?.plan === 'auto' && new Date(sub[0].expires_at).getTime() > Date.now())
  if (!allowed) return res.status(403).json({ error: 'Auto-trading needs the Signals + Auto-trading plan.' })

  if (req.method === 'DELETE') {
    await fetch(`${sb}/rest/v1/broker_secrets?user_id=eq.${user.id}`, { method: 'DELETE', headers: db })
    await fetch(`${sb}/rest/v1/broker_links?user_id=eq.${user.id}`, { method: 'DELETE', headers: db })
    return res.status(200).json({ ok: true })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST or DELETE only.' })

  const apiKey = String(req.body?.token ?? '').trim()
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(apiKey)) return res.status(400).json({ error: 'That does not look like a Deriv API token. Copy it again from Deriv.' })
  let blob: string
  try { blob = encrypt(apiKey) } catch { return res.status(500).json({ error: 'The server is missing its encryption key (TOKEN_ENCRYPTION_KEY).' }) }

  const v = await derivAuthorize(apiKey, process.env.DERIV_APP_ID || '1089')
  if (!v.ok && v.reason === 'invalid') return res.status(400).json({ error: 'Deriv says this token is not valid. Check it was copied fully, and that it has the Trade scope.' })

  const merge = { ...db, Prefer: 'resolution=merge-duplicates' }
  const s1 = await fetch(`${sb}/rest/v1/broker_secrets?on_conflict=user_id`, { method: 'POST', headers: merge, body: JSON.stringify({ user_id: user.id, broker: 'deriv', data: blob }) })
  const s2 = await fetch(`${sb}/rest/v1/broker_links?on_conflict=user_id`, {
    method: 'POST', headers: merge,
    body: JSON.stringify({ user_id: user.id, broker: 'deriv', loginid: v.ok ? v.loginid : null, is_virtual: v.ok ? v.isVirtual : null, currency: v.ok ? v.currency : null, status: v.ok ? 'verified' : 'unverified', linked_at: new Date().toISOString() }),
  })
  if (!s1.ok || !s2.ok) {
    const bad = !s1.ok ? s1 : s2
    const txt = await bad.text().catch(() => '')
    const noTable = /does not exist|PGRST205|42P01|schema cache/i.test(txt)
    return res.status(500).json({ error: noTable ? 'The database is missing a table. Run migration-2.sql in the Supabase SQL Editor.' : `The database refused the save (status ${bad.status}).` })
  }
  return res.status(200).json({ ok: true, status: v.ok ? 'verified' : 'unverified', note: v.ok ? undefined : v.message })
}
