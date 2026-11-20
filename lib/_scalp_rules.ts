// The scalp rules, in one place. Pure: no network, so they can be tested exactly.
// Open a position when the trend is clear. Close it as soon as it shows a small profit, then open the next one.
// The stop-loss is a safety net. There is no fixed take-profit for the scalp.
export const CLOSE_PROFIT = 0.20   // close a position once it is this far in profit (USD)
export const STOP_LOSS = 0.50      // close a position once it is this far in loss (USD)
export const MAX_OPEN = 3          // most positions open at once, per pair

export interface OpenPos { id: number; symbol: string; side: 'buy' | 'sell'; profit: number }
export type PlanSide = { side: 'buy' | 'sell' } | null

export function decide(pos: OpenPos[], plans: Record<string, PlanSide | undefined>) {
  const close: number[] = []
  const open: { symbol: string; side: 'buy' | 'sell' }[] = []
  const symbols = new Set<string>([...Object.keys(plans), ...pos.map((p) => p.symbol)])
  for (const s of symbols) {
    const plan = plans[s]?.side ?? null
    const mine = pos.filter((p) => p.symbol === s)
    let kept = 0
    for (const p of mine) {
      if (p.profit >= CLOSE_PROFIT) { close.push(p.id); continue }     // small profit: take it, make room for the next one
      if (p.profit <= -STOP_LOSS) { close.push(p.id); continue }       // safety stop
      if (plan !== p.side) { close.push(p.id); continue }              // the trend changed: protect the account
      kept++
    }
    if (plan && kept < MAX_OPEN) open.push({ symbol: s, side: plan })   // one new position per check, up to the limit
  }
  return { close, open }
}
