// Vercel function: the kill switch. Sells every open multiplier trade on the member's Deriv account and turns their bot off.
import { decrypt } from './_crypto.js'
import { dbHeaders, env, hasBotAccess, userFromJwt } from './_auth.js'

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
  try {
    // Get account_id from broker_links
    const linkRow = (await (await fetch(`${sb}/rest/v1/broker_links?user_id=eq.${user.id}&select=loginid`, { headers: h })).json()) as { loginid: string }[]
    const accountId = linkRow[0]?.loginid
    if (!accountId) return res.status(200).json({ ok: false, closed: 0, failed: 0, note: 'No linked account found. Bot is off.' })
    // Get OTP
    const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST', headers: { Authorization: `Bearer ${decrypt(secret[0].data)}`, 'Deriv-App-ID': process.env.DERIV_APP_ID ?? '', 'Content-Type': 'application/json' }, body: '{}',
    })
    if (!otpRes.ok) return res.status(200).json({ ok: false, closed: 0, failed: 0, note: 'Bot is off, but could not get OTP from Deriv. Close open trades manually in Deriv.' })
    const otpData = await otpRes.json() as any
    const wsUrl = otpData?.data?.url as string
    const otp = wsUrl ? new URL(wsUrl).searchParams.get('otp') : (otpData?.otp ?? otpData?.data?.otp)
    if (!otp) return res.status(200).json({ ok: false, closed: 0, failed: 0, note: 'Bot is off, but OTP not returned. Close open trades manually in Deriv.' })
    const WS = (globalThis as any).WebSocket
    if (!WS) return res.status(200).json({ ok: false, closed: 0, failed: 0, note: 'WebSocket not available. Close open trades manually in Deriv.' })
    // Connect and get portfolio + sell all multiplier trades
    const { closed, failed } = await new Promise<{ closed: number; failed: number }>((resolve) => {
      let done = false; let cl = 0; let fa = 0
      const timer = setTimeout(() => { if (!done) { done = true; resolve({ closed: cl, failed: fa }) } }, 30000)
      const ws = new WS(`wss://api.derivws.com/trading/v1/options/ws/demo?otp=${encodeURIComponent(otp)}`)
      ws.onerror = () => { if (!done) { done = true; clearTimeout(timer); resolve({ closed: cl, failed: fa }) } }
      let pending = 0; let portfolioDone = false
      const tryFinish = () => { if (portfolioDone && pending === 0 && !done) { done = true; clearTimeout(timer); try { ws.close() } catch {}; resolve({ closed: cl, failed: fa }) } }
      ws.onopen = () => ws.send(JSON.stringify({ portfolio: 1, req_id: 1 }))
      ws.onmessage = (ev: { data: string }) => {
        let m: any; try { m = JSON.parse(ev.data) } catch { return }
        if (m.msg_type === 'portfolio') {
          const contracts = ((m.portfolio?.contracts ?? []) as any[]).filter((c) => String(c.contract_type ?? '').startsWith('MULT'))
          if (!contracts.length) { portfolioDone = true; tryFinish(); return }
          pending = contracts.length
          contracts.forEach((c, i) => ws.send(JSON.stringify({ sell: c.contract_id, price: 0, req_id: 100 + i })))
          portfolioDone = true
        } else if (m.msg_type === 'sell') {
          m.error ? fa++ : cl++; pending--; tryFinish()
        }
      }
    })
    return res.status(200).json({ ok: failed === 0, closed, failed, note: failed ? 'Some trades could not be closed. Check Deriv.' : undefined })
  } catch (e) {
    return res.status(200).json({ ok: false, closed: 0, failed: 0, note: `Error: ${(e as Error).message}` })
  }
}
