// Vercel function: brings a member's results up to date from Deriv. For every trade the bot placed that is not yet marked
// closed, it asks Deriv how that trade stands: if it has ended, the profit or loss is saved; if it is still running, the
// current floating profit is returned. The key is only ever sent to Deriv.
import { decrypt } from './_crypto.js'
import { dbHeaders, env, hasBotAccess, userFromJwt } from './_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }
const cents = (x: number) => Math.round(x * 100) / 100

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  try {
    const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', ''))
    if (!user) return res.status(401).json({ error: 'Please sign in again.' })
    if (!(await hasBotAccess(user.id))) return res.status(403).json({ error: 'Auto-trading needs the Signals + Auto-trading plan.' })
    const { sb } = env(), h = dbHeaders()
    const rows = (await (await fetch(`${sb}/rest/v1/executions?user_id=eq.${user.id}&status=eq.bought&closed_at=is.null&contract_id=not.is.null&select=id,contract_id&order=created_at.desc&limit=40`, { headers: h })).json()) as { id: number; contract_id: number }[]
    if (!Array.isArray(rows) || !rows.length) return res.status(200).json({ ok: true, updated: 0, open: { count: 0, floating: 0 } })
    const secret = (await (await fetch(`${sb}/rest/v1/broker_secrets?user_id=eq.${user.id}&select=data`, { headers: h })).json()) as { data: string }[]
    if (!secret[0]) return res.status(200).json({ ok: false, note: 'No Deriv key is saved, so results could not be updated.' })

    // Get account_id from broker_links
    const linkRow = (await (await fetch(`${sb}/rest/v1/broker_links?user_id=eq.${user.id}&select=loginid`, { headers: h })).json()) as { loginid: string }[]
    const accountId = linkRow[0]?.loginid
    if (!accountId) return res.status(200).json({ ok: false, note: 'No linked account found. Remove your key and paste it again.' })

    // Get a one-time password for the WebSocket
    const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${decrypt(secret[0].data)}`, 'Deriv-App-ID': process.env.DERIV_APP_ID ?? '', 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!otpRes.ok) return res.status(200).json({ ok: false, note: `Could not get OTP from Deriv (${otpRes.status}).` })
    const otpData = await otpRes.json() as any
    const wsUrl = otpData?.data?.url as string
    const otp = wsUrl ? new URL(wsUrl).searchParams.get('otp') : (otpData?.otp ?? otpData?.data?.otp)
    if (!otp) return res.status(200).json({ ok: false, note: `OTP not in Deriv response: ${JSON.stringify(otpData).slice(0, 150)}` })

    const WS = (globalThis as any).WebSocket
    if (!WS) return res.status(200).json({ ok: false, note: 'WebSocket not available on this server.' })

    let updated = 0, count = 0, floating = 0

    for (const row of rows) {
      const result = await new Promise<{ sold: boolean; profit: number; sellPrice: number; sellTime: string } | null>((resolve) => {
        let done = false
        const timer = setTimeout(() => { if (!done) { done = true; resolve(null) } }, 10000)
        let ws: any
        try { ws = new WS(`wss://api.derivws.com/trading/v1/options/ws/demo?otp=${encodeURIComponent(otp)}`) } catch { clearTimeout(timer); return resolve(null) }
        ws.onerror = () => { if (!done) { done = true; clearTimeout(timer); resolve(null) } }
        ws.onopen = () => ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: Number(row.contract_id), req_id: 1 }))
        ws.onmessage = (ev: { data: string }) => {
          if (done) return
          let m: any; try { m = JSON.parse(ev.data) } catch { return }
          if (m.msg_type !== 'proposal_open_contract') return
          done = true; clearTimeout(timer); try { ws.close() } catch {}
          if (m.error || !m.proposal_open_contract) return resolve(null)
          const c = m.proposal_open_contract
          resolve({ sold: c.is_sold === 1 || c.is_sold === true, profit: Number(c.profit ?? 0), sellPrice: Number(c.sell_price ?? 0), sellTime: c.sell_time ? new Date(Number(c.sell_time) * 1000).toISOString() : new Date().toISOString() })
        }
      })
      if (!result) continue
      if (result.sold) {
        await fetch(`${sb}/rest/v1/executions?id=eq.${row.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ profit: cents(result.profit), sell_price: result.sellPrice, closed_at: result.sellTime }) })
        updated++
      } else { count++; floating += result.profit }
    }
    return res.status(200).json({ ok: true, updated, open: { count, floating: cents(floating) } })
  } catch (e) {
    return res.status(500).json({ error: `The server hit an error: ${(e as Error).message}` })
  }
}
