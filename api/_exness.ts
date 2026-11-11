/**
 * Exness Trader API client.
 * Authentication: Ed25519 signed requests.
 * Every request needs: EXN-API-KEY, EXN-TIMESTAMP, EXN-DATA (base64url body hash), EXN-SIGN (signature).
 * Flow: discover access point → sign requests → place trades.
 */
import { createPrivateKey, sign, createHash } from 'node:crypto'

// ── env helpers ───────────────────────────────────────────────────────────────
function cfg() {
  return {
    apiKey:       process.env.EXN_API_KEY       ?? '',
    privateKey:   process.env.EXN_PRIVATE_KEY   ?? '',
    accountId:    process.env.EXN_ACCOUNT_ID    ?? '',
    discoveryUrl: process.env.EXN_DISCOVERY_BASE_URL ?? 'https://api.exness.com',
  }
}

export function exnessConfigured(): boolean {
  const { apiKey, privateKey, accountId } = cfg()
  return !!(apiKey && privateKey && accountId)
}

// ── request signing ───────────────────────────────────────────────────────────
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function loadKey(raw: string) {
  // Exness can supply a 128-hex private key (seed || pubkey) or a PEM string
  const hex = raw.trim()
  if (/^[0-9a-fA-F]{128}$/.test(hex)) {
    // 64-byte Ed25519: first 32 bytes = seed
    const seed = Buffer.from(hex.slice(0, 64), 'hex')
    const keyDer = Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      seed,
    ])
    return createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' })
  }
  // PEM (PKCS#8)
  return createPrivateKey({ key: hex, format: 'pem' })
}

function signedHeaders(method: string, path: string, body: string, apiKey: string, privateKey: string) {
  const ts = Date.now().toString()
  const bodyBuf = Buffer.from(body, 'utf8')
  const dataHash = b64url(Buffer.from(
    createHash('sha256').update(bodyBuf).digest()
  ))
  const msg = `${method.toUpperCase()}\n${path}\n${ts}\n${dataHash}`
  const pk = loadKey(privateKey)
  const sig = b64url(sign(null, Buffer.from(msg, 'utf8'), pk))
  return {
    'EXN-API-KEY':   apiKey,
    'EXN-TIMESTAMP': ts,
    'EXN-DATA':      dataHash,
    'EXN-SIGN':      sig,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  }
}

// ── discovery ─────────────────────────────────────────────────────────────────
let _accessPoint: string | null = null
let _accessPointTs = 0
const ACCESS_POINT_TTL = 5 * 60 * 1000

async function getAccessPoint(accountId: string): Promise<string> {
  if (_accessPoint && Date.now() - _accessPointTs < ACCESS_POINT_TTL) return _accessPoint
  const { apiKey, privateKey, discoveryUrl } = cfg()
  const path = `/trader/v1/accounts/${accountId}/discovery`
  const headers = signedHeaders('GET', path, '', apiKey, privateKey)
  const r = await fetch(`${discoveryUrl}${path}`, { headers, signal: AbortSignal.timeout(10000) })
  if (!r.ok) throw new Error(`Discovery failed ${r.status}: ${await r.text().catch(() => '')}`)
  const d = await r.json() as { access_point?: string; data?: { access_point?: string } }
  const ap = d.access_point ?? d.data?.access_point
  if (!ap) throw new Error(`No access_point in discovery response: ${JSON.stringify(d).slice(0, 200)}`)
  _accessPoint = ap; _accessPointTs = Date.now()
  return ap
}

// ── REST helpers ──────────────────────────────────────────────────────────────
type Ok<T> = { ok: true; data: T }
type Fail  = { ok: false; code: string; message: string; status?: number }
export type Result<T> = Ok<T> | Fail

async function req<T>(method: string, path: string, body: unknown, base: string): Promise<Result<T>> {
  const { apiKey, privateKey } = cfg()
  const bodyStr = body ? JSON.stringify(body) : ''
  const headers = signedHeaders(method, path, bodyStr, apiKey, privateKey)
  try {
    const r = await fetch(`${base}${path}`, {
      method, headers, body: bodyStr || undefined, signal: AbortSignal.timeout(12000),
    })
    const json = await r.json().catch(() => ({})) as any
    if (!r.ok) {
      const msg = json?.message ?? json?.error ?? r.statusText
      return { ok: false, code: json?.code ?? 'api_error', message: `${msg} | ${JSON.stringify(json).slice(0, 200)}`, status: r.status }
    }
    return { ok: true, data: (json.data ?? json) as T }
  } catch (e: any) {
    if (e?.name === 'TimeoutError') return { ok: false, code: 'timeout', message: 'Exness did not answer in time.' }
    return { ok: false, code: 'unreachable', message: `Could not reach Exness: ${e.message}` }
  }
}

// ── public API ────────────────────────────────────────────────────────────────
export interface ExnessAccount {
  account_id: string
  account_type: string    // 'demo' | 'live'
  balance: number
  equity: number
  currency: string
  status: string
}

export async function listAccounts(): Promise<Result<ExnessAccount[]>> {
  if (!exnessConfigured()) return { ok: false, code: 'not_configured', message: 'Exness API keys are not set in Vercel settings.' }
  const { accountId } = cfg()
  try {
    const ap = await getAccessPoint(accountId)
    const r = await req<any>('GET', `/trader/v1/accounts`, null, ap)
    if (!r.ok) return r
    const list = Array.isArray(r.data) ? r.data : r.data?.accounts ?? [r.data]
    return { ok: true, data: list as ExnessAccount[] }
  } catch (e: any) { return { ok: false, code: 'error', message: e.message } }
}

export interface ExnessOrder {
  accountId: string
  symbol: string         // e.g. EURUSD
  side: 'buy' | 'sell'
  volume: number         // lots, e.g. 0.01
  stopLoss?: number
  takeProfit?: number
  comment?: string
}

export async function placeOrder(o: ExnessOrder): Promise<Result<{ orderId: string; volume: number; price: number }>> {
  if (!exnessConfigured()) return { ok: false, code: 'not_configured', message: 'Exness API keys are not set in Vercel settings.' }
  if (o.volume < 0.01 || o.volume > 1.0) return { ok: false, code: 'invalid_volume', message: `Volume ${o.volume} outside allowed range 0.01–1.0 lots.` }
  const { accountId } = cfg()
  try {
    const ap = await getAccessPoint(accountId)
    const body: Record<string, unknown> = {
      account_id: o.accountId,
      symbol: o.symbol,
      side: o.side.toUpperCase(),
      type: 'MARKET',
      volume: o.volume,
      comment: o.comment ?? 'fx-desk-bot',
    }
    if (o.stopLoss)   body.stop_loss   = o.stopLoss
    if (o.takeProfit) body.take_profit = o.takeProfit
    const r = await req<any>('POST', `/trader/v1/orders`, body, ap)
    if (!r.ok) return r
    const d = r.data as any
    return { ok: true, data: { orderId: String(d.order_id ?? d.id ?? ''), volume: Number(d.volume ?? o.volume), price: Number(d.price ?? 0) } }
  } catch (e: any) { return { ok: false, code: 'error', message: e.message } }
}

export async function getPositions(accountId: string): Promise<Result<any[]>> {
  if (!exnessConfigured()) return { ok: false, code: 'not_configured', message: 'Exness API keys are not set.' }
  try {
    const ap = await getAccessPoint(accountId)
    const r = await req<any>('GET', `/trader/v1/positions?account_id=${accountId}`, null, ap)
    if (!r.ok) return r
    return { ok: true, data: Array.isArray(r.data) ? r.data : r.data?.positions ?? [] }
  } catch (e: any) { return { ok: false, code: 'error', message: e.message } }
}

export async function closePosition(accountId: string, positionId: string): Promise<Result<{ closed: boolean }>> {
  if (!exnessConfigured()) return { ok: false, code: 'not_configured', message: 'Exness API keys are not set.' }
  try {
    const ap = await getAccessPoint(accountId)
    const r = await req<any>('DELETE', `/trader/v1/positions/${positionId}?account_id=${accountId}`, null, ap)
    if (!r.ok) return r
    return { ok: true, data: { closed: true } }
  } catch (e: any) { return { ok: false, code: 'error', message: e.message } }
}

export async function getAccountInfo(accountId: string): Promise<Result<ExnessAccount>> {
  if (!exnessConfigured()) return { ok: false, code: 'not_configured', message: 'Exness API keys are not set.' }
  try {
    const ap = await getAccessPoint(accountId)
    const r = await req<any>('GET', `/trader/v1/accounts/${accountId}`, null, ap)
    if (!r.ok) return r
    return { ok: true, data: r.data as ExnessAccount }
  } catch (e: any) { return { ok: false, code: 'error', message: e.message } }
}
