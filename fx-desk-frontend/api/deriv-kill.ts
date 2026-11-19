// Vercel function: the kill switch. Sells every open multiplier trade on the member's Deriv account and turns their bot off.
import { decrypt } from './_crypto.js'
import { dbHeaders, env, hasBotAccess, userFromJwt } from './_auth.js'
import { DerivSession } from './_trade.js'

interface Req { method?: string; headers: Record<string, string | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', ''))
  if (!user) return res.status(401).json({ error: 'Please sign in again.' })
  if (!(await hasBotAccess(user.id))) return res.status(403).json({ error: 'Auto-trading needs the Signals + Auto-trading plan.' })
  const { sb } = env(), h = dbHeaders()
  // turn the bot off FIRST, so nothing new opens while we close things
  await fetch(`${sb}/rest/v1/bot_state?user_id=eq.${user.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ bot_on: false, kill_requested: false, note: 'Kill switch used. Bot is off.' }) })
  const secret = (await (await fetch(`${sb}/rest/v1/broker_secrets?user_id=eq.${user.id}&select=data`, { headers: h })).json()) as { data: string }[]
  if (!secret[0]) return res.status(200).json({ ok: true, closed: 0, failed: 0, note: 'Bot is off. No Deriv key is saved.' })
  let session: DerivSession | null = null
  try {
    session = await DerivSession.open(process.env.DERIV_APP_ID || '1089')
    const auth = await session.request({ authorize: decrypt(secret[0].data) })
    if (auth.error) return res.status(200).json({ ok: false, closed: 0, failed: 0, note: 'Bot is off, but Deriv refused the saved key, so open trades were NOT closed. Close them in Deriv.' })
    const pf = await session.request({ portfolio: 1 })
    const open = ((pf.portfolio?.contracts ?? []) as any[]).filter((c) => String(c.contract_type ?? '').startsWith('MULT'))
    let closed = 0, failed = 0
    for (const c of open) { const r = await session.request({ sell: c.contract_id, price: 0 }); r.error ? failed++ : closed++ }
    return res.status(200).json({ ok: failed === 0, closed, failed, note: failed ? 'Some trades could not be closed. Check Deriv.' : undefined })
  } catch {
    return res.status(200).json({ ok: false, closed: 0, failed: 0, note: 'Bot is off, but Deriv could not be reached, so open trades were NOT closed. Close them in Deriv.' })
  } finally {
    session?.close()
  }
}
