/**
 * Exness Trader API — correct Ed25519 signing per the official docs.
 *
 * Every request needs these headers:
 *   EXN-API-KEY        public API key identifier
 *   EXN-IDEMPOTENCY-KEY  empty for GET, non-empty UUID for mutating requests
 *   EXN-TIMESTAMP      Unix ms
 *   EXN-SIGN-VERSION   "1"
 *   EXN-DATA           base64url (no padding) of the JSON signing payload
 *   EXN-SIGN           base64url (no padding) Ed25519 sig of the DECODED EXN-DATA bytes
 *
 * The signing payload is a JSON object (not a plain string):
 * { api_key, idempotency_key, timestamp, sign_version, method, path, body_hash }
 * where body_hash = SHA-256 of the raw request body, base64url no padding.
 * For empty-body requests, body_hash is the SHA-256 of "" =
 *   "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU"
 */
import { createHash, createPrivateKey, sign as edSign } from 'node:crypto'

// ── env ───────────────────────────────────────────────────────────────────────
function cfg() {
  return {
    apiKey:       process.env.EXN_API_KEY            ?? '',
    privateKey:   process.env.EXN_PRIVATE_KEY        ?? '',
    accountId:    process.env.EXN_ACCOUNT_ID         ?? '',
    discoveryUrl: process.env.EXN_DISCOVERY_BASE_URL ?? 'https://api.exness.com',
  }
}
export function exnessConfigured(): boolean {
  const { apiKey, privateKey, accountId } = cfg()
  return !!(apiKey && privateKey && accountId)
}

// ── helpers ───────────────────────────────────────────────────────────────────
const EMPTY_BODY_HASH = '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function bodyHash(body: string): string {
  if (!body) return EMPTY_BODY_HASH
  return b64url(createHash('sha256').update(body, 'utf8').digest())
}

function loadPrivateKey(raw: string) {
  const hex = raw.trim()
  if (/^[0-9a-fA-F]{128}$/.test(hex)) {
    // Exness-generated: 64-byte hex (seed || pubkey). Use the first 32 bytes as seed.
    const seed = Buffer.from(hex.slice(0, 64), 'hex')
    // Wrap in PKCS#8 DER envelope for Ed25519
    const header = Buffer.from('302e020100300506032b657004220420', 'hex')
    return createPrivateKey({ key: Buffer.concat([header, seed]), format: 'der', type: 'pkcs8' })
  }
  // PEM PKCS#8 (self-generated with OpenSSL)
  return createPrivateKey({ key: hex.includes('-----') ? hex : `-----BEGIN PRIVATE KEY-----\n${hex}\n-----END PRIVATE KEY-----`, format: 'pem' })
}

function makeHeaders(method: string, path: string, body: string, idempotencyKey: string): Record<string, string> {
  const { apiKey, privateKey } = cfg()
  const ts = Date.now()
  const payload = {
    api_key:          apiKey,
    idempotency_key:  idempotencyKey,
    timestamp:        ts,
    sign_version:     1,
    method:           method.toUpperCase(),
    path,
    body_hash:        bodyHash(body),
  }
  const payloadJson = JSON.stringify(payload)
  const payloadBytes = Buffer.from(payloadJson, 'utf8')
  const exnData = b64url(payloadBytes)
  const pk = loadPrivateKey(privateKey)
  const sigBytes = edSign(null, payloadBytes, pk)
  const exnSign = b64url(sigBytes)
  return {
    'EXN-API-KEY':          apiKey,
    'EXN-IDEMPOTENCY-KEY':  idempotencyKey,
    'EXN-TIMESTAMP':        String(ts),
    'EXN-SIGN-VERSION':     '1',
    'EXN-DATA':             exnData,
    'EXN-SIGN':             exnSign,
    'Content-Type':         'application/json',
    'Accept':               'application/json',
  }
}

function idempotencyKey(): string {
  return `fxd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ── discovery: resolve Access Point ──────────────────────────────────────────
let _ap: string | null = null, _apTs = 0
const AP_TTL = 5 * 60 * 1000

async function getAccessPoint(): Promise<string> {
  if (_ap && Date.now() - _apTs < AP_TTL) return _ap
  const { discoveryUrl, accountId } = cfg()
  // Per the Exness docs: GET /v1/trading/access-point?account_id=... on the Gateway.
  // The signed path must include the query string exactly as it is sent.
  const path = `/v1/trading/access-point?account_id=${accountId}`
  const headers = makeHeaders('GET', path, '', '')
  const r = await fetch(`${discoveryUrl}${path}`, { headers, signal: AbortSignal.timeout(10000) })
  const j = await r.json().catch(() => ({})) as any
  if (!r.ok) throw new Error(`Discovery failed ${r.status}: ${j.error_message ?? JSON.stringify(j).slice(0, 150)}`)
  const ap = j.access_point ?? j.data?.access_point ?? j.host
  if (!ap) throw new Error(`No access_point in discovery response: ${JSON.stringify(j).slice(0, 200)}`)
  _ap = ap; _apTs = Date.now()
  return ap
}

// ── REST wrapper ──────────────────────────────────────────────────────────────
type Ok<T>  = { ok: true; data: T }
type Fail   = { ok: false; code: string; message: string; status?: number }
export type Result<T> = Ok<T> | Fail

async function req<T>(method: string, path: string, body: unknown, ikey?: string): Promise<Result<T>> {
  const bodyStr = body ? JSON.stringify(body) : ''
  const ik = ikey ?? (method === 'GET' ? '' : idempotencyKey())
  try {
    const ap = await getAccessPoint()
    const headers = makeHeaders(method, path, bodyStr, ik)
    const r = await fetch(`${ap}${path}`, {
      method, headers, body: bodyStr || undefined, signal: AbortSignal.timeout(12000),
    })
    const j = await r.json().catch(() => ({})) as any
    if (!r.ok) {
      const msg = j?.error_message ?? j?.message ?? j?.error ?? r.statusText
      return { ok: false, code: j?.error_code ?? j?.code ?? 'api_error', message: `${msg} | ${JSON.stringify(j).slice(0, 200)}`, status: r.status }
    }
    return { ok: true, data: (j.data ?? j) as T }
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.message?.includes('timed out')) return { ok: false, code: 'timeout', message: 'Exness did not answer in time.' }
    return { ok: false, code: 'unreachable', message: `Could not reach Exness: ${e.message}` }
  }
}

// ── public API ────────────────────────────────────────────────────────────────
export interface ExnessAccount {
  account_id: string; account_type: string; balance: string; equity: string; currency: string; status: string
}

export async function getAccountInfo(): Promise<Result<ExnessAccount>> {
  if (!exnessConfigured()) return { ok: false, code: 'not_configured', message: 'Exness API keys are not set in Vercel.' }
  const { accountId } = cfg()
  return req<ExnessAccount>('GET', `/v1/configuration/accounts/${accountId}/account`, null)
}

export async function getPositions(): Promise<Result<any[]>> {
  if (!exnessConfigured()) return { ok: false, code: 'not_configured', message: 'Exness API keys are not set in Vercel.' }
  const { accountId } = cfg()
  const r = await req<any>('GET', `/v1/trading/accounts/${accountId}/positions`, null)
  if (!r.ok) return r
  return { ok: true, data: Array.isArray(r.data) ? r.data : r.data?.positions ?? [] }
}

export interface PlaceOrderInput {
  symbol: string; side: 'buy' | 'sell'; volume: number; stopLoss?: number; takeProfit?: number; comment?: string
}

export async function placeOrder(o: PlaceOrderInput): Promise<Result<{ operationId: string }>> {
  if (!exnessConfigured()) return { ok: false, code: 'not_configured', message: 'Exness API keys are not set in Vercel.' }
  if (o.volume < 0.01 || o.volume > 1.0) return { ok: false, code: 'invalid_volume', message: `Volume ${o.volume} outside allowed range 0.01–1.0 lots.` }
  const { accountId } = cfg()
  const ik = idempotencyKey()
  const body: Record<string, unknown> = {
    instrument: o.symbol, side: o.side.toUpperCase(), order_type: 'MARKET',
    volume: String(o.volume), client_comment: o.comment ?? 'fx-desk',
  }
  if (o.stopLoss)   body.stop_loss   = String(o.stopLoss)
  if (o.takeProfit) body.take_profit = String(o.takeProfit)
  const r = await req<any>('POST', `/v1/trading/accounts/${accountId}/orders`, body, ik)
  if (!r.ok) return r
  const opId = r.data?.operation_id ?? r.data?.id ?? ik
  return { ok: true, data: { operationId: String(opId) } }
}

export async function getCandles(symbol: string, timeframe: string, from: string, count = 100): Promise<Result<any[]>> {
  if (!exnessConfigured()) return { ok: false, code: 'not_configured', message: 'Exness API keys are not set.' }
  const { accountId } = cfg()
  const path = `/v1/market-data/accounts/${accountId}/candles?instrument=${symbol}&timeframe=${timeframe}&from=${encodeURIComponent(from)}&count=${count}&price_type=bid`
  const r = await req<any>('GET', path, null)
  if (!r.ok) return r
  return { ok: true, data: r.data?.candles ?? r.data ?? [] }
}
