// Deriv trading helpers: a small WebSocket session and the position-sizing maths. Nothing here ever logs or returns a token.
export const SYMBOLS: Record<string, string> = {
  EURUSD: 'frxEURUSD', USDJPY: 'frxUSDJPY', USDCHF: 'frxUSDCHF', USDCAD: 'frxUSDCAD', AUDUSD: 'frxAUDUSD', XAUUSD: 'frxXAUUSD',
}
export const MIN_STAKE = 1   // hard limits, whatever a member types
export const MAX_STAKE = 10

export type Plan =
  | { ok: true; contract_type: 'MULTUP' | 'MULTDOWN'; multiplier: number; stop_loss: number; take_profit: number }
  | { ok: false; reason: string }

const cents = (x: number) => Math.round(x * 100) / 100

/** Turns the signal's price levels into a Deriv multiplier contract. The stop-loss is sized to lose at most
 *  `riskFraction` of the stake, using the largest multiplier Deriv allows that keeps it under that. */
export function planTrade(s: { side: string; entry: number; sl: number; tp1: number }, stake: number, multipliers: number[], riskFraction = 0.5): Plan {
  const slDist = Math.abs(s.entry - s.sl), tpDist = Math.abs(s.tp1 - s.entry)
  const good = [s.entry, s.sl, s.tp1, stake].every((x) => Number.isFinite(x) && x > 0) && slDist > 0 && tpDist > 0
  const sideOk = s.side === 'buy' ? s.sl < s.entry && s.tp1 > s.entry : s.side === 'sell' ? s.sl > s.entry && s.tp1 < s.entry : false
  if (!good || !sideOk) return { ok: false, reason: 'The signal levels do not make sense.' }
  const wanted = (riskFraction * s.entry) / slDist
  const fits = multipliers.filter((m) => m > 0 && m <= wanted)
  if (!fits.length) return { ok: false, reason: 'The stop is too wide for the smallest multiplier Deriv offers.' }
  const multiplier = Math.max(...fits)
  const stop_loss = cents((stake * multiplier * slDist) / s.entry)
  const take_profit = cents((stake * multiplier * tpDist) / s.entry)
  if (stop_loss < 0.01 || take_profit < 0.01) return { ok: false, reason: 'The stop or target is too small to place.' }
  return { ok: true, contract_type: s.side === 'buy' ? 'MULTUP' : 'MULTDOWN', multiplier, stop_loss, take_profit }
}

type WS = { onopen: any; onmessage: any; onerror: any; onclose: any; send(d: string): void; close(): void }

export class DerivSession {
  private n = 0
  private waiting = new Map<number, (m: any) => void>()
  private constructor(private ws: WS) {
    ws.onmessage = (ev: { data: unknown }) => {
      let m: any
      try { m = JSON.parse(String(ev.data)) } catch { return }
      const w = this.waiting.get(m.req_id)
      if (w) { this.waiting.delete(m.req_id); w(m) }
    }
    const drop = () => { for (const w of this.waiting.values()) w({ error: { code: 'ConnectionClosed', message: 'The connection to Deriv closed.' } }); this.waiting.clear() }
    ws.onerror = drop
    ws.onclose = drop
  }
  static open(appId: string, timeoutMs = 10000): Promise<DerivSession> {
    const WS = (globalThis as unknown as { WebSocket?: new (u: string) => WS }).WebSocket
    return new Promise((resolve, reject) => {
      if (!WS) return reject(new Error('This server cannot open a WebSocket.'))
      let ws: WS
      const timer = setTimeout(() => reject(new Error('Deriv did not answer in time.')), timeoutMs)
      try { ws = new WS(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`) } catch { clearTimeout(timer); return reject(new Error('Could not reach Deriv.')) }
      ws.onopen = () => { clearTimeout(timer); resolve(new DerivSession(ws)) }
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Could not reach Deriv.')) }
    })
  }
  /** Sends one request and resolves with Deriv's answer (which may contain `error`). Never rejects. */
  request(msg: Record<string, unknown>, timeoutMs = 10000): Promise<any> {
    return new Promise((resolve) => {
      const id = ++this.n
      const timer = setTimeout(() => { this.waiting.delete(id); resolve({ error: { code: 'Timeout', message: 'Deriv did not answer in time.' } }) }, timeoutMs)
      this.waiting.set(id, (m) => { clearTimeout(timer); resolve(m) })
      try { this.ws.send(JSON.stringify({ ...msg, req_id: id })) } catch { clearTimeout(timer); this.waiting.delete(id); resolve({ error: { code: 'SendFailed', message: 'Could not send to Deriv.' } }) }
    })
  }
  close() { try { this.ws.close() } catch { /* already closed */ } }
}

export const errText = (m: any) => `${m?.error?.message ?? 'Deriv returned an error.'}`.slice(0, 200)

// ---------- scalp mode: the bot reads the market itself ----------
export interface MarketState { symbol: string; trend: string; price: number; ema50: number; atr: number; updated_at: string }
export const SCALP_TP_ATR = 0.5   // take profit: half a typical candle
export const SCALP_SL_ATR = 2     // emergency stop: two typical candles
export const STALE_MS = 10 * 60000
export type ScalpPlan = { ok: true; side: 'buy' | 'sell'; entry: number; sl: number; tp1: number } | { ok: false; reason: string }

/** Same idea as the signal strategy: the bigger trend is confirmed, and price sits on the right side of the 5-minute average
 *  without having run too far from it. Then a small quick trade is allowed. */
export function planScalp(m: MarketState, now = Date.now()): ScalpPlan {
  const no = (reason: string): ScalpPlan => ({ ok: false, reason })
  if (!SYMBOLS[m?.symbol]) return no('unknown symbol')
  const side = m.trend === 'buy' ? 'buy' : m.trend === 'sell' ? 'sell' : null
  if (!side) return no('no confirmed trend')
  const [p, e, a] = [Number(m.price), Number(m.ema50), Number(m.atr)]
  if (![p, e, a].every((x) => Number.isFinite(x) && x > 0)) return no('bad market numbers')
  const at = Date.parse(m.updated_at)
  if (!Number.isFinite(at) || now - at > STALE_MS) return no('market data is stale')
  if (side === 'buy' ? p <= e : p >= e) return no('price is on the wrong side of the average')
  if (Math.abs(p - e) > 1.5 * a) return no('price has run too far from the average')
  const d = side === 'buy' ? 1 : -1
  return { ok: true, side, entry: p, sl: p - d * SCALP_SL_ATR * a, tp1: p + d * SCALP_TP_ATR * a }
}
