import type { ReactNode } from 'react'
import type { Signal } from './types'

export type IconName = 'logo' | 'home' | 'bars' | 'bot' | 'user' | 'play' | 'stop' | 'out' | 'lock'
const P: Record<IconName, ReactNode> = {
  logo: <path d="M3 17l5-6 4 3 8-9M15 5h5v5" />, home: <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />, bars: <path d="M5 20V10M12 20V4M19 20v-7" />,
  bot: <path d="M12 3v3M5 7h14v11H5zM9.5 12h.01M14.5 12h.01" />, user: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6" />,
  play: <path d="M7 5l12 7-12 7z" />, stop: <rect x="6" y="6" width="12" height="12" rx="1" />, out: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
}
export const Icon = ({ n }: { n: IconName }) => <i><svg viewBox="0 0 24 24">{P[n]}</svg></i>
export const Brand = () => <div className="brand"><span className="mk"><Icon n="logo" /></span>FX Desk</div>

export const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`
}
export const usd = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`
export const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export const STRAT: Record<string, string> = { trend_pullback: 'Trend pullback', structure_retest: 'Structure retest' }
const left = (iso: string) => {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  return m <= 0 ? null : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}
export function SignalRow({ s }: { s: Signal }) {
  const sl = s.sl ?? s.runner_sl, tp1 = s.tp1 ?? s.scalp_tp
  const valid = s.expires_at && !s.outcome ? left(s.expires_at) : null
  const done = s.outcome === 'tp' ? `Hit TP1 · +${(s.result_r ?? 0).toFixed(1)}R` : s.outcome === 'sl' ? 'Stopped out · -1R'
    : s.outcome === 'expired' ? `Expired · ${(s.result_r ?? 0) >= 0 ? '+' : ''}${(s.result_r ?? 0).toFixed(1)}R` : null
  return (
    <div className="sig">
      <span className={`tag ${s.side === 'buy' ? 'b' : 's'}`}>{s.side === 'buy' ? 'Buy' : 'Sell'}</span>
      <b>{s.symbol}{s.timeframe && <span className="tg">{s.timeframe}</span>}</b><span className="mu">{ago(s.created_at)}</span>
      <div className="nums"><span>Entry <b>{s.entry}</b></span>{sl != null && <span>SL <b>{sl}</b></span>}{tp1 != null && <span>TP1 <b>{tp1}</b></span>}{s.tp2 != null && <span>TP2 <b>{s.tp2}</b></span>}</div>
      {(s.strategy || valid || done) && <div className="mu" style={{ gridColumn: '1 / -1' }}>
        {s.strategy && `${STRAT[s.strategy] ?? s.strategy}${s.htf ? ` · ${s.htf} trend` : ''}`}
        {valid && ` · valid for ${valid}`}{!valid && !done && s.expires_at && ' · entry window passed'}
        {s.max_hold_min ? ` · hold up to ${Math.round(s.max_hold_min / 60)}h` : ''}
      </div>}
      {done && <div className={s.outcome === 'tp' ? 'ok' : 'neg'} style={{ gridColumn: '1 / -1', fontSize: 13 }}>{done}</div>}
      {s.win_rate != null && s.pf != null && <div className="mu" style={{ gridColumn: '1 / -1' }}>Backtest: {Math.round(s.win_rate * 100)}% wins · profit factor {s.pf} · {s.bt_trades} trades</div>}
    </div>
  )
}
export function Locked({ go, title = 'Signals need an active plan', text = 'Get access to see live signals as they appear.', cta = 'Get access' }: { go: () => void; title?: string; text?: string; cta?: string }) {
  return (
    <div className="card lock"><Icon n="lock" /><h3 style={{ margin: '8px 0' }}>{title}</h3>
      <p className="mu">{text}</p><button className="btn p" onClick={go}>{cta}</button></div>
  )
}
