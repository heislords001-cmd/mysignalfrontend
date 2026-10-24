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
