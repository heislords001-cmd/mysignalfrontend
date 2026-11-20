// The live part of the scalp: reads a member's open multiplier trades from Deriv, closes the ones the rules say to close,
// and returns the pairs that should get a new position. Uses the same Deriv connection as the kill switch.
import { decrypt } from './_crypto.js'
import { dbHeaders, env } from './_auth.js'
import { SYMBOLS } from './_trade.js'
import { decide, type OpenPos, type PlanSide } from './_scalp_rules.js'

const REVERSE: Record<string, string> = Object.fromEntries(Object.entries(SYMBOLS).map(([ours, deriv]) => [deriv, ours]))

// One websocket conversation: each request gets its reply by req_id.
function session(url: string): Promise<{ ask: (p: Record<string, unknown>, timeoutMs?: number) => Promise<any>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const WS = (globalThis as any).WebSocket
    if (!WS) return reject(new Error('websocket not available'))
    const ws = new WS(url)
    const waiters = new Map<number, (m: any) => void>()
    let seq = 1
    ws.onmessage = (ev: { data: string }) => {
      let m: any; try { m = JSON.parse(ev.data) } catch { return }
      const w = waiters.get(m.req_id); if (w) { waiters.delete(m.req_id); w(m) }
    }
    ws.onerror = () => reject(new Error('websocket error'))
    ws.onopen = () => resolve({
      ask: (p, timeoutMs = 10000) => new Promise((ok, fail) => {
        const id = seq++
        const t = setTimeout(() => { waiters.delete(id); fail(new Error('Deriv did not answer in time')) }, timeoutMs)
        waiters.set(id, (m) => { clearTimeout(t); ok(m) })
        ws.send(JSON.stringify({ ...p, req_id: id }))
      }),
      close: () => { try { ws.close() } catch {} },
    })
  })
}

export interface MonitorResult { closed: number; failed: number; opens: { symbol: string; side: 'buy' | 'sell' }[]; note?: string }

// Checks one member's open scalp trades against the plans, closes what the rules say, and reports what to open.
export async function monitorMember(userId: string, plans: Record<string, PlanSide | undefined>): Promise<MonitorResult> {
  const { sb } = env(), h = dbHeaders()
  const secret = (await (await fetch(`${sb}/rest/v1/broker_secrets?user_id=eq.${userId}&select=data`, { headers: h })).json()) as { data: string }[]
  const link = (await (await fetch(`${sb}/rest/v1/broker_links?user_id=eq.${userId}&select=loginid`, { headers: h })).json()) as { loginid: string }[]
  if (!secret[0] || !link[0]) return { closed: 0, failed: 0, opens: [], note: 'no Deriv link' }
  const token = decrypt(secret[0].data)
  const accountId = link[0].loginid
  const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Deriv-App-ID': process.env.DERIV_APP_ID ?? '', 'Content-Type': 'application/json' }, body: '{}',
  })
  if (!otpRes.ok) return { closed: 0, failed: 0, opens: [], note: 'could not get a Deriv session' }
  const otpData = (await otpRes.json()) as { otp?: string; url?: string }
  const otp = otpData.otp ?? (otpData.url ? new URL(otpData.url).searchParams.get('otp') : null)
  if (!otp) return { closed: 0, failed: 0, opens: [], note: 'Deriv did not return a session' }

  const s = await session(`wss://api.derivws.com/trading/v1/options/ws/demo?otp=${encodeURIComponent(otp)}`)
  try {
    const port = await s.ask({ portfolio: 1 })
    const contracts = ((port.portfolio?.contracts ?? []) as any[])
      .filter((c) => String(c.contract_type ?? '').startsWith('MULT') && REVERSE[c.symbol ?? c.underlying_symbol ?? ''])
    const pos: OpenPos[] = []
    for (const c of contracts) {
      const q = await s.ask({ proposal_open_contract: 1, contract_id: c.contract_id })
      const profit = Number(q.proposal_open_contract?.profit ?? 0)
      pos.push({ id: Number(c.contract_id), symbol: REVERSE[c.symbol ?? c.underlying_symbol], side: String(c.contract_type).includes('DOWN') ? 'sell' : 'buy', profit })
    }
    const { close, open } = decide(pos, plans)
    let closed = 0, failed = 0
    for (const id of close) {
      const r = await s.ask({ sell: id, price: 0 })
      if (r.error) failed++; else closed++
    }
    return { closed, failed, opens: open }
  } finally {
    s.close()
  }
}
