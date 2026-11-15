export type Signal = {
  id: number; created_at: string; symbol: string; side: 'buy' | 'sell'; entry: number
  timeframe: string | null; htf: string | null; strategy: string | null
  sl: number | null; tp1: number | null; tp2: number | null; expires_at: string | null; max_hold_min: number | null
  win_rate: number | null; pf: number | null; bt_trades: number | null; outcome: string | null; result_r: number | null
  scalp_tp: number | null; runner_sl: number | null   // older signals
}
export type StratStat = { symbol: string; timeframe: string; strategy: string; enabled: boolean; trades: number; win_rate: number; pf: number; test_pf: number; test_n: number; updated_at: string }
export type ScannerState = { running: boolean; heartbeat: string | null; last_error: string | null }
export type BotState = { bot_on: boolean; kill_requested: boolean; note: string | null }
export type BotAccount = { balance: number; equity: number; floating: number; closed_today: number; scalps: number; runners: number; basket_pct: number; daily_pct: number; lots: number; updated_at: string | null }
export type BotPos = { ticket: number; symbol: string; side: 'buy' | 'sell'; lot: number; entry: number; sl: number | null; tp: number | null; profit: number; tag: 'scalp' | 'runner' }
export type Profile = { id: string; email: string; role: 'user' | 'admin' }
export type Sub = { plan: string; expires_at: string }
export type Payment = { id: number; reference: string; plan: string; amount: number; status: string; created_at: string }
export type Cfg = Record<string, number | boolean>

export const DEFAULTS: Cfg = {
  adx_min: 25, scalp_tp_atr: 0.5, runner_sl_atr: 1.5, session_start_utc: 12, session_end_utc: 16,
  scalp_target: 6, runner_max: 3, max_lot_per_trade: 0.1, max_total_lots: 3, basket_stop_pct: 3, daily_loss_pct: 3,
  small_account: false, risk_budget_pct: 15, hard_stop_atr: 2, margin_use_max_pct: 40,
}
export const SMALL: Cfg = {
  small_account: true, scalp_target: 2, runner_max: 1, max_lot_per_trade: 0.01, max_total_lots: 0.05,
  risk_budget_pct: 15, hard_stop_atr: 2, margin_use_max_pct: 40, basket_stop_pct: 12, daily_loss_pct: 20,
}
