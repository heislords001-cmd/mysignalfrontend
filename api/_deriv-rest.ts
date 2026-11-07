/**
 * Deriv REST client (new API: https://api.derivws.com)
 * Uses PAT tokens. Every call requires Deriv-App-ID header.
 * Returns { ok: true, data } or { ok: false, code, message, status }.
 * The token is never echoed in error messages.
 */

export interface DerivAccount {
  account_id: string
  balance: number
  currency: string
  group: string
  status: 'active' | 'inactive'
  account_type: 'demo' | 'real'
}

type Ok<T> = { ok: true; data: T }
type Fail = { ok: false; code: string; message: string; status?: number }
export type Result<T> = Ok<T> | Fail

const BASE = 'https://api.derivws.com'
const TIMEOUT_MS = 10000

function appId(): string {
  return process.env.DERIV_APP_ID ?? ''
}

function headers(token: string): Record<string, string> {
  const id = appId()
  if (!id) throw new Error('no_app_id')
  return {
    'Authorization': `Bearer ${token}`,
    'Deriv-App-ID': id,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
}

async function get<T>(path: string, token: string): Promise<Result<T>> {
  if (!appId()) return { ok: false, code: 'no_app_id', message: 'DERIV_APP_ID is not set in Vercel settings.' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(`${BASE}${path}`, { headers: headers(token), signal: ctrl.signal })
    clearTimeout(timer)
    const body = await r.json().catch(() => ({})) as any
    if (!r.ok) {
      const err = body?.errors?.[0] ?? {}
      const bodyStr = JSON.stringify(body).slice(0, 300)
      return { ok: false, code: err.code ?? 'api_error', message: `${err.message ?? r.statusText} | response: ${bodyStr}`, status: r.status }
    }
    return { ok: true, data: body as T }
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') return { ok: false, code: 'timeout', message: 'Deriv did not answer in time.' }
    return { ok: false, code: 'unreachable', message: 'Could not reach Deriv.' }
  }
}

async function post<T>(path: string, token: string, body: unknown): Promise<Result<T>> {
  if (!appId()) return { ok: false, code: 'no_app_id', message: 'DERIV_APP_ID is not set in Vercel settings.' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: headers(token), body: JSON.stringify(body), signal: ctrl.signal })
    clearTimeout(timer)
    const resp = await r.json().catch(() => ({})) as any
    if (!r.ok) {
      const err = resp?.errors?.[0] ?? {}
      const respStr = JSON.stringify(resp).slice(0, 300)
      return { ok: false, code: err.code ?? 'api_error', message: `${err.message ?? r.statusText} | response: ${respStr}`, status: r.status }
    }
    return { ok: true, data: resp as T }
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') return { ok: false, code: 'timeout', message: 'Deriv did not answer in time.' }
    return { ok: false, code: 'unreachable', message: 'Could not reach Deriv.' }
  }
}

/** List all accounts for this token */
export async function listAccounts(token: string): Promise<Result<{ data: DerivAccount[] }>> {
  return get('/trading/v1/options/accounts', token)
}

/** Pick the first active demo account, or null */
export function pickDemoAccount(accounts: DerivAccount[]): DerivAccount | null {
  return accounts.find((a) => a.account_type === 'demo' && a.status === 'active') ?? null
}

/** Verify a token: returns the demo account or a failure */
export async function verifyToken(token: string): Promise<Result<{ account: DerivAccount; loginid: string; currency: string; isVirtual: true }>> {
  const r = await listAccounts(token)
  if (!r.ok) return r
  const acct = pickDemoAccount(r.data.data)
  if (!acct) return { ok: false, code: 'not_demo', message: 'No active demo account found. Connect a Deriv demo account.' }
  return { ok: true, data: { account: acct, loginid: acct.account_id, currency: acct.currency, isVirtual: true } }
}

export interface MultiplierOrder {
  token: string
  accountId: string
  symbol: string         // e.g. frxEURUSD
  side: 'buy' | 'sell'
  stake: number
  multiplier: number
  stopLoss: number
  takeProfit: number
  currency: string
}

/** Place one multiplier trade on a demo account */
export async function placeMultiplier(o: MultiplierOrder): Promise<Result<{ contractId: number; buyPrice: number; transactionId: number; accountId: string }>> {
  if (!appId()) return { ok: false, code: 'no_app_id', message: 'DERIV_APP_ID is not set in Vercel settings.' }
  if (o.stake < 1 || o.stake > 10) return { ok: false, code: 'stake_out_of_range', message: `Stake $${o.stake} is outside the allowed range of $1 to $10.` }
  if (o.stopLoss > o.stake * 0.5) return { ok: false, code: 'stop_too_wide', message: `Stop loss $${o.stopLoss} exceeds half of the stake $${o.stake}.` }

  const params = {
    contract_type: o.side === 'buy' ? 'MULTUP' : 'MULTDOWN',
    underlying_symbol: o.symbol,
    currency: o.currency,
    amount: o.stake,
    basis: 'stake',
    multiplier: o.multiplier,
    // stop_loss and take_profit are top-level fields in the bulk-purchase body, not inside contract_parameters
  }
  const body = {
    contract_parameters: params,
    stop_loss: o.stopLoss,
    take_profit: o.takeProfit,
    accounts: [{ token: o.token, account_id: o.accountId }],
  }
  const r = await post<any>('/trading/v1/options/contracts/bulk-purchase/demo', o.token, body)
  if (!r.ok) return r
  const tx = r.data?.data?.transactions?.[0]
  if (!tx) return { ok: false, code: 'no_transaction', message: 'Deriv returned no transaction.' }
  if (tx.error) return { ok: false, code: tx.error.code ?? 'trade_error', message: tx.error.message ?? 'Deriv rejected the trade.' }
  return { ok: true, data: { contractId: tx.contract_id, buyPrice: tx.buy_price, transactionId: tx.transaction_id, accountId: tx.account_id } }
}
