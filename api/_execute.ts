// The trading engine: a new signal arrives, and every member who has the bot ON gets a trade on their Deriv account.
// Safety rules, all enforced here: approved signals only (admin may opt in to untested ones), DEMO accounts only for now,
// stake capped, trades per day capped, open trades capped, one trade per signal per member.
import { decrypt } from './_crypto'
import { dbHeaders, env } from './_auth'
import { DerivSession, MAX_STAKE, MIN_STAKE, SYMBOLS, errText, planTrade } from './_trade'

export interface Signal { id: number; symbol: string; side: string; entry: number; sl: number; tp1: number; approved?: boolean; expires_at?: string | null }
type Row = Record<string, any>
const clamp = (x: unknown, lo: number, hi: number, dflt: number) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt }

async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${env().sb}/rest/v1/${path}`, { ...init, headers: { ...dbHeaders(), ...((init.headers as Record<string, string>) ?? {}) } })
  return r.json().catch(() => [])
}
const group = (rows: Row[]) => new Map<string, Row>((rows as Row[]).map((r) => [r.user_id ?? r.id, r]))

export function checkSignal(s: Signal): string | null {
  if (!s || !SYMBOLS[s.symbol]) return 'unknown symbol'
  if (![s.entry, s.sl, s.tp1].every((x) => Number.isFinite(Number(x)))) return 'missing price levels'
  if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) return 'signal already expired'
  return null
}

export async function executeSignal(s: Signal): Promise<{ considered: number; bought: number; skipped: number; failed: number; note?: string }> {
  const out = { considered: 0, bought: 0, skipped: 0, failed: 0 }
  const bad = checkSignal(s)
  if (bad) return { ...out, note: bad }
  const on = (await rest('bot_state?bot_on=eq.true&select=user_id')) as Row[]
  const ids = on.map((r) => r.user_id)
  if (!ids.length) return { ...out, note: 'no member has the bot on' }
  const list = `in.(${ids.join(',')})`
  const [profiles, subs, links, secrets, settings] = await Promise.all([
    rest(`profiles?id=${list}&select=id,role`), rest(`subscriptions?user_id=${list}&select=user_id,plan,expires_at`),
    rest(`broker_links?user_id=${list}&select=user_id`), rest(`broker_secrets?user_id=${list}&select=user_id,data`), rest(`user_settings?user_id=${list}&select=user_id,data`),
  ])
  const P = group(profiles), S = group(subs), L = group(links), K = group(secrets), U = group(settings)
  const approved = s.approved !== false
  const eligible = ids.filter((id) => {
    const admin = P.get(id)?.role === 'admin'
    const sub = S.get(id)
    const plan = admin || (sub?.plan === 'auto' && new Date(sub.expires_at).getTime() > Date.now())
    const mayTrade = approved || (admin && U.get(id)?.data?.trade_untested === true)      // untested signals: admin's own demo only
    return plan && mayTrade && L.has(id) && K.has(id)
  })
  out.considered = eligible.length
  for (let i = 0; i < eligible.length; i += 5) {                                              // five members at a time
    await Promise.all(eligible.slice(i, i + 5).map(async (id) => {
      const r = await tradeForMember(id, s, K.get(id)!.data, U.get(id)?.data ?? {})
      out[r === 'bought' ? 'bought' : r === 'skipped' ? 'skipped' : r === 'failed' ? 'failed' : 'skipped']++
    }))
  }
  return out
}

async function tradeForMember(userId: string, s: Signal, secret: string, cfg: Row): Promise<'bought' | 'skipped' | 'failed' | 'duplicate'> {
  // claim this (member, signal) first: if it already exists, another delivery handled it, so do nothing
  const claim = await rest('executions?on_conflict=user_id,signal_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ user_id: userId, signal_id: s.id, status: 'pending' }) })
  if (!Array.isArray(claim) || claim.length === 0) return 'duplicate'
  const rowId = claim[0].id
  const finish = async (status: 'bought' | 'skipped' | 'failed', message: string, extra: Row = {}) => {
    await rest(`executions?id=eq.${rowId}`, { method: 'PATCH', body: JSON.stringify({ status, message: message.slice(0, 200), ...extra }) })
    return status
  }
  let session: DerivSession | null = null
  try {
    const stake = clamp(cfg.stake_usd, MIN_STAKE, MAX_STAKE, MIN_STAKE)
    const maxOpen = Math.round(clamp(cfg.max_open, 1, 10, 3)), dailyMax = Math.round(clamp(cfg.daily_max, 1, 50, 10))
    const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0)
    const today = (await rest(`executions?user_id=eq.${userId}&status=eq.bought&created_at=gte.${midnight.toISOString()}&select=id`)) as Row[]
    if (today.length >= dailyMax) return await finish('skipped', `Daily limit of ${dailyMax} trades reached.`)

    session = await DerivSession.open(process.env.DERIV_APP_ID || '1089')
    const auth = await session.request({ authorize: decrypt(secret) })
    if (auth.error) return await finish('failed', `Deriv refused the key: ${errText(auth)}`)
    if (!auth.authorize?.is_virtual) return await finish('skipped', 'Real accounts are locked for now. Connect a Deriv demo account.')   // demo-only gate, checked live
    const currency = String(auth.authorize.currency || 'USD')

    const pf = await session.request({ portfolio: 1 })
    const open = ((pf.portfolio?.contracts ?? []) as Row[]).filter((c) => String(c.contract_type ?? '').startsWith('MULT')).length
    if (open >= maxOpen) return await finish('skipped', `Already ${open} trades open (limit ${maxOpen}).`)

    const cf = await session.request({ contracts_for: SYMBOLS[s.symbol], product_type: 'basic' })
    const type = s.side === 'buy' ? 'MULTUP' : 'MULTDOWN'
    const multipliers = ((cf.contracts_for?.available ?? []) as Row[]).filter((c) => c.contract_type === type && Array.isArray(c.multiplier_range)).flatMap((c) => c.multiplier_range as number[])
    const plan = planTrade({ side: s.side, entry: Number(s.entry), sl: Number(s.sl), tp1: Number(s.tp1) }, stake, multipliers.length ? multipliers : [100])
    if (!plan.ok) return await finish('skipped', plan.reason)

    const prop = await session.request({
      proposal: 1, amount: stake, basis: 'stake', contract_type: plan.contract_type, currency, symbol: SYMBOLS[s.symbol],
      multiplier: plan.multiplier, limit_order: { stop_loss: plan.stop_loss, take_profit: plan.take_profit },
    })
    if (prop.error || !prop.proposal?.id) return await finish('failed', `Deriv would not quote it: ${errText(prop)}`)
    const buy = await session.request({ buy: prop.proposal.id, price: Number(prop.proposal.ask_price ?? stake) })
    if (buy.error || !buy.buy?.contract_id) return await finish('failed', `Deriv did not accept the trade: ${errText(buy)}`)
    return await finish('bought', `Bought ${plan.contract_type} x${plan.multiplier}.`, { contract_id: buy.buy.contract_id, stake, stop_loss: plan.stop_loss, take_profit: plan.take_profit, multiplier: plan.multiplier })
  } catch (e) {
    return await finish('failed', `Could not trade: ${(e as Error).message}`)
  } finally {
    session?.close()
  }
}
