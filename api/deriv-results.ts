// Vercel function: brings a member's results up to date from Deriv. For every trade the bot placed that is not yet marked
// closed, it asks Deriv how that trade stands: if it has ended, the profit or loss is saved; if it is still running, the
// current floating profit is returned. The key is only ever sent to Deriv.
import { decrypt } from './_crypto.js'
import { dbHeaders, env, hasBotAccess, userFromJwt } from './_auth.js'
import { DerivSession } from './_trade.js'

interface Req { method?: string; headers: Record<string, string | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }
const cents = (x: number) => Math.round(x * 100) / 100

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  let session: DerivSession | null = null
  try {
    const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', ''))
    if (!user) return res.status(401).json({ error: 'Please sign in again.' })
    if (!(await hasBotAccess(user.id))) return res.status(403).json({ error: 'Auto-trading needs the Signals + Auto-trading plan.' })
    const { sb } = env(), h = dbHeaders()
    const rows = (await (await fetch(`${sb}/rest/v1/executions?user_id=eq.${user.id}&status=eq.bought&closed_at=is.null&contract_id=not.is.null&select=id,contract_id&order=created_at.desc&limit=40`, { headers: h })).json()) as { id: number; contract_id: number }[]
    if (!Array.isArray(rows) || !rows.length) return res.status(200).json({ ok: true, updated: 0, open: { count: 0, floating: 0 } })
    const secret = (await (await fetch(`${sb}/rest/v1/broker_secrets?user_id=eq.${user.id}&select=data`, { headers: h })).json()) as { data: string }[]
    if (!secret[0]) return res.status(200).json({ ok: false, note: 'No Deriv key is saved, so results could not be updated.' })

    session = await DerivSession.open(process.env.DERIV_APP_ID || '1089')
    const auth = await session.request({ authorize: decrypt(secret[0].data) })
    if (auth.error) return res.status(200).json({ ok: false, note: 'Deriv refused the saved key, so results could not be updated.' })

    let updated = 0, count = 0, floating = 0
    for (const r of rows) {
      const poc = await session.request({ proposal_open_contract: 1, contract_id: Number(r.contract_id) })
      const c = poc.proposal_open_contract
      if (poc.error || !c) continue
      if (c.is_sold === 1 || c.is_sold === true) {
        const closedAt = c.sell_time ? new Date(Number(c.sell_time) * 1000).toISOString() : new Date().toISOString()
        await fetch(`${sb}/rest/v1/executions?id=eq.${r.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ profit: cents(Number(c.profit ?? 0)), sell_price: Number(c.sell_price ?? 0), closed_at: closedAt }) })
        updated++
      } else {
        count++
        floating += Number(c.profit ?? 0)
      }
    }
    return res.status(200).json({ ok: true, updated, open: { count, floating: cents(floating) } })
  } catch (e) {
    return res.status(500).json({ error: `The server hit an error: ${(e as Error).message}` })
  } finally {
    session?.close()
  }
}
