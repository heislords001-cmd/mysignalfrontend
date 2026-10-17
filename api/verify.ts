// Vercel serverless function: confirms a Paystack payment and unlocks access. Keep PLANS in sync with src/plans.ts.
const PLANS: Record<string, { amount: number; days: number }> = { signals: { amount: 15000, days: 30 }, auto: { amount: 35000, days: 30 } }

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { reference?: string; plan?: string } }
interface Res { status(c: number): Res; json(b: unknown): void }

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  const { reference, plan } = req.body ?? {}
  const p = plan ? PLANS[plan] : undefined
  if (!token || !reference || !p) return res.status(400).json({ error: 'Bad request' })

  const sb = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_KEY!
  const db = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

  const u = await fetch(`${sb}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } })
  if (!u.ok) return res.status(401).json({ error: 'Please sign in again' })
  const user = (await u.json()) as { id: string; email: string }

  const v = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } })
  const pv = (await v.json()) as { status: boolean; data?: { status: string; amount: number; currency: string; customer?: { email?: string } } }
  const d = pv.data
  if (!pv.status || !d || d.status !== 'success') return res.status(402).json({ error: 'Payment not completed' })
  if (d.currency !== 'NGN' || d.amount !== p.amount * 100) return res.status(402).json({ error: 'Amount does not match the plan' })
  if ((d.customer?.email ?? '').toLowerCase() !== user.email.toLowerCase()) return res.status(403).json({ error: 'This payment belongs to another account' })

  // record once: a repeated reference is ignored, so nobody can claim the same payment twice
  const ins = await fetch(`${sb}/rest/v1/payments?on_conflict=reference`, {
    method: 'POST', headers: { ...db, Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ user_id: user.id, reference, plan, amount: p.amount, currency: 'NGN', status: 'success' }),
  })
  if (!ins.ok) return res.status(500).json({ error: 'Could not save payment' })
  if (((await ins.json()) as unknown[]).length === 0) return res.status(200).json({ ok: true, already: true })

  const cur = await fetch(`${sb}/rest/v1/subscriptions?user_id=eq.${user.id}&select=plan,expires_at`, { headers: db })
  const rows = (await cur.json()) as { plan: string; expires_at: string }[]
  const start = Math.max(Date.now(), rows[0] ? new Date(rows[0].expires_at).getTime() : 0)
  const expires = new Date(start + p.days * 86400000).toISOString()
  const keepAuto = !!rows[0] && rows[0].plan === 'auto' && new Date(rows[0].expires_at).getTime() > Date.now()   // never downgrade an active Auto-trading plan
  const up = await fetch(`${sb}/rest/v1/subscriptions?on_conflict=user_id`, {
    method: 'POST', headers: { ...db, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: user.id, plan: keepAuto ? 'auto' : plan, expires_at: expires }),
  })
  if (!up.ok) return res.status(500).json({ error: 'Payment saved but access could not be updated. Contact support.' })
  return res.status(200).json({ ok: true, expires_at: expires })
}
