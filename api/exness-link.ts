// Save and verify an Exness API key. Stores it encrypted, same pattern as Deriv.
import { encrypt } from './_crypto.js'
import { dbHeaders, env, hasBotAccess, userFromJwt } from './_auth.js'
import { exnessConfigured, getAccountInfo } from './_exness.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { api_key?: string; private_key?: string; account_id?: string; discovery_url?: string } }
interface Res { status(c: number): Res; json(b: unknown): void }

export default async function handler(req: Req, res: Res) {
  try {
    const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', ''))
    if (!user) return res.status(401).json({ error: 'Please sign in again.' })
    if (!(await hasBotAccess(user.id))) return res.status(403).json({ error: 'Auto-trading needs the Signals + Auto-trading plan.' })
    const { sb } = env(), h = dbHeaders()

    if (req.method === 'DELETE') {
      await fetch(`${sb}/rest/v1/broker_secrets?user_id=eq.${user.id}&broker=eq.exness`, { method: 'DELETE', headers: h })
      await fetch(`${sb}/rest/v1/broker_links?user_id=eq.${user.id}&broker=eq.exness`, { method: 'DELETE', headers: h })
      return res.status(200).json({ ok: true })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST or DELETE only.' })

    const missing = ['EXN_API_KEY', 'EXN_PRIVATE_KEY', 'EXN_ACCOUNT_ID'].filter((k) => !process.env[k])
    if (missing.length) return res.status(500).json({ error: `Server settings missing: ${missing.join(', ')}. Add them in Vercel as Secrets and redeploy.` })
    if (!process.env.TOKEN_ENCRYPTION_KEY) return res.status(500).json({ error: 'TOKEN_ENCRYPTION_KEY not set in Vercel.' })

    // Verify by listing accounts
    const r = await getAccountInfo()
    if (!r.ok) return res.status(400).json({ error: `Exness rejected the credentials: ${r.message}` })
    const acct = r.data

    // Store encrypted private key
    const blob = encrypt(process.env.EXN_PRIVATE_KEY!)
    const merge = { ...h, Prefer: 'resolution=merge-duplicates' }
    await Promise.all([
      fetch(`${sb}/rest/v1/broker_secrets?on_conflict=user_id,broker`, { method: 'POST', headers: merge, body: JSON.stringify({ user_id: user.id, broker: 'exness', data: blob }) }),
      fetch(`${sb}/rest/v1/broker_links?on_conflict=user_id,broker`, { method: 'POST', headers: merge, body: JSON.stringify({ user_id: user.id, broker: 'exness', loginid: acct.account_id, is_virtual: acct.account_type === 'demo', currency: acct.currency, status: 'verified', linked_at: new Date().toISOString() }) }),
    ])
    return res.status(200).json({ ok: true, status: 'verified', loginid: acct.account_id, currency: acct.currency, isDemo: acct.account_type === 'demo' })
  } catch (e) {
    return res.status(500).json({ error: `Server error: ${(e as Error).message}` })
  }
}
