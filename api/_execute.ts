// The trading engine, two modes:
//  1. SIGNAL mode: the scanner saves a signal, and every member with the bot ON gets that trade on their Deriv account.
//  2. SCALP mode: the scanner saves what it sees on a pair; members who switched scalp mode on get small quick trades while
//     the trend is confirmed. Deriv closes each one by itself at its small take profit (or its stop), and the next pass opens another.
// Safety rules, all enforced here: DEMO accounts only for now, stake capped, trades per day capped, open trades capped,
// one trade per signal / per market reading per member, and a stop loss on every trade.
import { decrypt } from './_crypto.js'
import { dbHeaders, env } from './_auth.js'
import { DerivSession, MAX_STAKE, MIN_STAKE, SYMBOLS, errText, planScalp, planTrade } from './_trade.js'
import { placeMultiplier } from './_deriv-rest.js'
import type { MarketState } from './_trade.js'

export interface Signal { id: number; symbol: string; side: string; entry: number; sl: number; tp1: number; approved?: boolean; expires_at?: string | null }
export type Market = MarketState
type Row = Record<string, any>
type Result = 'bought' | 'skipped' | 'failed' | 'duplicate'
export interface Tally { considered: number; bought: number; skipped: number; failed: number; note?: string }
interface Order { kind: 'signal' | 'scalp'; key: string; signalId: number | null; symbol: string; side: 'buy' | 'sell'; entry: number; sl: number; tp1: number }

const clamp = (x: unknown, lo: number, hi: number, dflt: number) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt }
const zero = (): Tally => ({ considered: 0, bought: 0, skipped: 0, failed: 0 })

async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${env().sb}/rest/v1/${path}`, { ...init, headers: { ...dbHeaders(), ...((init.headers as Record<string, string>) ?? {}) } })
  return r.json().catch(() => [])
}
const group = (rows: Row[]) => new Map<string, Row>((rows as Row[]).map((r) => [r.user_id ?? r.id, r]))

async function loadMembers() {
  const on = (await rest('bot_state?bot_on=eq.true&select=user_id')) as Row[]
  const ids = on.map((r) => r.user_id)
  if (!ids.length) return null
  const list = `in.(${ids.join(',')})`
  const [profiles, subs, links, secrets, settings] = await Promise.all([
    rest(`profiles?id=${list}&select=id,role`), rest(`subscriptions?user_id=${list}&select=user_id,plan,expires_at`),
    rest(`broker_links?user_id=${list}&select=user_id`), rest(`broker_secrets?user_id=${list}&select=user_id,data`), rest(`user_settings?user_id=${list}&select=user_id,data`),
  ])
  return { ids, P: group(profiles), S: group(subs), L: group(links), K: group(secrets), U: group(settings) }
}
type Members = NonNullable<Awaited<ReturnType<typeof loadMembers>>>
const hasPlan = (m: Members, id: string) => m.P.get(id)?.role === 'admin' || (m.S.get(id)?.plan === 'auto' && new Date(m.S.get(id)!.expires_at).getTime() > Date.now())

export function checkSignal(s: Signal): string | null {
  if (!s || !SYMBOLS[s.symbol]) return 'unknown symbol'
  if (![s.entry, s.sl, s.tp1].every((x) => Number.isFinite(Number(x)))) return 'missing price levels'
  if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) return 'signal already expired'
  return null
}

async function runOrder(order: Order, ids: string[], m: Members): Promise<Tally> {
  const out = zero()
  out.considered = ids.length
  for (let i = 0; i < ids.length; i += 5) {                                                   // five members at a time
    await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      const r = await placeForMember(id, order, m.K.get(id)!.data, m.U.get(id)?.data ?? {})
      out[r === 'bought' ? 'bought' : r === 'failed' ? 'failed' : 'skipped']++
    }))
  }
  return out
}

export async function executeSignal(s: Signal): Promise<Tally> {
  const bad = checkSignal(s)
  if (bad) return { ...zero(), note: bad }
  const m = await loadMembers()
  if (!m) return { ...zero(), note: 'no member has the bot on' }
  const approved = s.approved !== false
  const eligible = m.ids.filter((id) => {
    const admin = m.P.get(id)?.role === 'admin'
    const mayTrade = approved || (admin && m.U.get(id)?.data?.trade_untested === true)      // untested signals: the admin's own demo only
    return hasPlan(m, id) && mayTrade && m.L.has(id) && m.K.has(id)
  })
  return runOrder({ kind: 'signal', key: `signal:${s.id}`, signalId: s.id, symbol: s.symbol, side: s.side as 'buy' | 'sell', entry: Number(s.entry), sl: Number(s.sl), tp1: Number(s.tp1) }, eligible, m)
}

export async function executeScalp(mk: Market): Promise<Tally> {
  const plan = planScalp(mk)
  if (!plan.ok) return { ...zero(), note: plan.reason }
  const m = await loadMembers()
  if (!m) return { ...zero(), note: 'no member has the bot on' }
  const eligible = m.ids.filter((id) => hasPlan(m, id) && m.L.has(id) && m.K.has(id) && m.U.get(id)?.data?.scalp_enabled === true)
  return runOrder({ kind: 'scalp', key: `scalp:${mk.symbol}:${mk.updated_at}`, signalId: null, symbol: mk.symbol, side: plan.side, entry: plan.entry, sl: plan.sl, tp1: plan.tp1 }, eligible, m)
}

/** One safe demo trade on the member's own account, without waiting for a signal or a webhook. Uses the same rules as a real signal. */
export async function executeTest(userId: string): Promise<{ status: string; message: string }> {
  const secret = (await rest(`broker_secrets?user_id=eq.${userId}&select=data`)) as Row[]
  if (!secret[0]) return { status: 'skipped', message: 'Connect your Deriv key first.' }
  const cfg = (((await rest(`user_settings?user_id=eq.${userId}&select=data`)) as Row[])[0]?.data ?? {}) as Row
  const key = `test:${userId}:${new Date().toISOString().slice(0, 16)}`
  const r = await placeForMember(userId, { kind: 'signal', key, signalId: null, symbol: 'EURUSD', side: 'buy', entry: 1.1, sl: 1.098, tp1: 1.103 }, secret[0].data, cfg)
  if (r === 'duplicate') return { status: 'skipped', message: 'A test was just sent. Wait a minute before sending another.' }
  const row = ((await rest(`executions?user_id=eq.${userId}&dedupe_key=eq.${encodeURIComponent(key)}&select=status,message`)) as Row[])[0]
  return { status: row?.status ?? r, message: row?.message ?? '' }
}

async function placeForMember(userId: string, o: Order, secret: string, cfg: Row): Promise<Result> {
  // claim this (member, signal or market reading) first: if it already exists, another delivery handled it, so do nothing
  const claim = await rest('executions?on_conflict=user_id,dedupe_key', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ user_id: userId, signal_id: o.signalId, kind: o.kind, symbol: o.symbol, side: o.side, dedupe_key: o.key, status: 'pending' }),
  })
  if (!Array.isArray(claim) || claim.length === 0) return 'duplicate'
  const rowId = claim[0].id
  const finish = async (status: 'bought' | 'skipped' | 'failed', message: string, extra: Row = {}): Promise<Result> => {
    await rest(`executions?id=eq.${rowId}`, { method: 'PATCH', body: JSON.stringify({ status, message: message.slice(0, 200), ...extra }) })
    return status
  }
  const scalp = o.kind === 'scalp'
  try {
    const stake = clamp(scalp ? cfg.scalp_stake_usd ?? cfg.stake_usd : cfg.stake_usd, MIN_STAKE, MAX_STAKE, MIN_STAKE)
    const maxOpen = Math.round(scalp ? clamp(cfg.scalp_max_open, 1, 20, 6) : clamp(cfg.max_open, 1, 10, 3) + (cfg.scalp_enabled === true ? clamp(cfg.scalp_max_open, 1, 20, 6) : 0))
    const perPair = Math.round(clamp(cfg.scalp_max_per_pair, 1, 5, 2))
    const dailyMax = Math.round(scalp ? clamp(cfg.scalp_daily_max, 1, 100, 20) : clamp(cfg.daily_max, 1, 50, 10))
    const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0)
    const today = (await rest(`executions?user_id=eq.${userId}&status=eq.bought&kind=eq.${o.kind}&created_at=gte.${midnight.toISOString()}&select=id`)) as Row[]
    if (today.length >= dailyMax) return await finish('skipped', `Daily limit of ${dailyMax} ${o.kind} trades reached.`)

    // --- Deriv REST API (new flow) ---
    // Get the account_id stored when the key was verified
    const linkRow = (await rest(`broker_links?user_id=eq.${userId}&select=loginid,currency`)) as Row[]
    const accountId = linkRow[0]?.loginid ?? null
    const currency = String(linkRow[0]?.currency ?? 'USD')
    if (!accountId) return await finish('skipped', 'Deriv account not linked yet. Remove your key and paste it again.')

    // Open limit check using executions (we no longer need portfolio from WebSocket for this)
    const openTrades = (await rest(`executions?user_id=eq.${userId}&status=eq.bought&closed_at=is.null&select=id,symbol`)) as Row[]
    const openMult = openTrades.length
    if (openMult >= maxOpen) return await finish('skipped', `Already ${openMult} trades open (limit ${maxOpen}).`)
    if (scalp && openTrades.filter((r) => r.symbol === o.symbol).length >= perPair) return await finish('skipped', `Already ${perPair} scalps open on ${o.symbol}.`)

    // Size the trade
    const plan = planTrade({ side: o.side, entry: o.entry, sl: o.sl, tp1: o.tp1 }, stake, [30, 50, 100, 200, 300, 500])
    if (!plan.ok) return await finish('skipped', plan.reason)

    // Place via REST bulk-purchase/demo
    const trade = await placeMultiplier({
      token: decrypt(secret), accountId, symbol: SYMBOLS[o.symbol],
      side: o.side as 'buy' | 'sell', stake, multiplier: plan.multiplier,
      stopLoss: plan.stop_loss, takeProfit: plan.take_profit, currency,
    })
    if (!trade.ok) {
      const failed = trade.code === 'stake_out_of_range' || trade.code === 'stop_too_wide' || trade.code === 'no_app_id'
      return await finish(failed ? 'skipped' : 'failed', trade.message)
    }
    return await finish('bought', `${scalp ? 'Scalp b' : 'B'}ought ${plan.contract_type} x${plan.multiplier}.`, {
      contract_id: trade.data.contractId, stake, stop_loss: plan.stop_loss, take_profit: plan.take_profit, multiplier: plan.multiplier,
    })
  } catch (e) {
    const msg = `Could not trade: ${(e as Error).message ?? String(e)}`
    try {
      return await finish('failed', msg)
    } catch {
      // finish itself failed (e.g. the executions row doesn't exist yet)
      // try a direct PATCH as a last resort
      try {
        const { sb } = env(), h = dbHeaders()
        await fetch(`${sb}/rest/v1/executions?user_id=eq.${userId}&status=eq.pending&order=created_at.desc&limit=1`,
          { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'failed', message: msg.slice(0, 200) }) })
      } catch { /* nothing left to do */ }
      return 'failed'
    }
  }
}
