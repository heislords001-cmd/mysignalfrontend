import { useState, type ReactNode } from 'react'
import type { Signal } from './types'
import { useTheme } from './theme'

export type IconName = 'logo' | 'home' | 'bars' | 'bot' | 'user' | 'play' | 'stop' | 'out' | 'lock' | 'sun' | 'moon' | 'camera'
const P: Record<IconName, ReactNode> = {
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  logo: <path d="M3 17l5-6 4 3 8-9M15 5h5v5" />, home: <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />, bars: <path d="M5 20V10M12 20V4M19 20v-7" />,
  bot: <path d="M12 3v3M5 7h14v11H5zM9.5 12h.01M14.5 12h.01" />, user: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6" />,
  play: <path d="M7 5l12 7-12 7z" />, stop: <rect x="6" y="6" width="12" height="12" rx="1" />, out: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
}
export const Icon = ({ n }: { n: IconName }) => <i><svg viewBox="0 0 24 24">{P[n]}</svg></i>
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  return <button className="btn sm iconbtn" onClick={toggle} aria-label={label} title={label}><Icon n={theme === 'dark' ? 'sun' : 'moon'} /></button>
}
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
export function Locked({ go, title = 'Signals need an active plan', text = 'Get access to see live signals as they appear.', cta = 'Get access' }: { go: () => void; title?: string; text?: string; cta?: string }) {
  return (
    <div className="card lock"><Icon n="lock" /><h3 style={{ margin: '8px 0' }}>{title}</h3>
      <p className="mu">{text}</p><button className="btn p" onClick={go}>{cta}</button></div>
  )
}


// The text that gets copied: plain lines that paste cleanly anywhere.
export function signalText(s: Signal): string {
  const hm = s.max_hold_min ? Math.floor(s.max_hold_min / 60) : 0, hmin = s.max_hold_min ? s.max_hold_min % 60 : 0
  const hold = s.max_hold_min ? ` · hold up to ${hm}h${hmin ? ` ${hmin}m` : ''}` : ''
  const lines = [
    `${String(s.side).toUpperCase()} ${s.symbol}${s.timeframe ? ` · ${s.timeframe}` : ''}${hold}`,
    `ENTRY: ${s.entry}`,
    `STOP LOSS: ${s.sl ?? '-'}`,
    `TAKE PROFIT 1: ${s.tp1 ?? '-'}`,
  ]
  if (s.tp2 != null) lines.push(`TAKE PROFIT 2: ${s.tp2}`)
  if (s.approved === false) lines.push('Status: untested signal')
  return lines.join('\n')
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      // older browsers and some phones block the clipboard API: fall back to a hidden text box
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      ok = document.execCommand('copy')
      document.body.removeChild(ta)
    }
    if (ok) { setDone(true); setTimeout(() => setDone(false), 1800) }
  }
  return <button className="btn sm copy-btn" onClick={copy} aria-label="Copy signal">{done ? 'Copied' : 'Copy'}</button>
}

export function SignalCard({ s }: { s: Signal }) {
  const sl = s.sl ?? s.runner_sl, tp1 = s.tp1 ?? s.scalp_tp
  const live = !s.outcome && !!s.expires_at && new Date(s.expires_at).getTime() > Date.now()
  const r = s.result_r ?? 0
  const status = s.outcome === 'tp' ? { c: 'win', t: 'Win' } : s.outcome === 'sl' ? { c: 'loss', t: 'Loss' }
    : s.outcome === 'expired' ? { c: 'open', t: 'Ended' } : live ? { c: 'live', t: 'Live' } : { c: 'open', t: 'Open' }
  const hold = s.max_hold_min ? `hold up to ${Math.round(s.max_hold_min / 60)}h` : ''
  const note = s.strategy ? `${STRAT[s.strategy] ?? s.strategy}${s.htf ? ` · ${s.htf} trend agrees` : ''}` : ''
  return (
    <div className="scard">
      <div className="top">
        <span className="sym">{s.symbol}</span>
        <span className={`badge ${s.side}`}>{s.side}</span>
        <span className={`badge ${status.c}`}>{status.c === 'live' && <span className="dot2" />}{status.t}</span>
        {s.approved === false && <span className="badge test">Untested</span>}
        {s.outcome && <span className={r >= 0 ? 'ok' : 'neg'} style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 13 }}>{r >= 0 ? '+' : ''}{r.toFixed(1)}R</span>}
        {!s.outcome && <span style={{ marginLeft: 'auto' }}><CopyButton text={signalText(s)} /></span>}
      </div>
      {s.timeframe && <div className="sub">{s.symbol} · {s.timeframe}{hold && ` · ${hold}`}</div>}
      <div className="pills">
        <div className="pill entry"><span className="pl">ENTRY</span><span className="pv">{s.entry}</span></div>
        <div className="pill sl"><span className="pl">STOP LOSS</span><span className="pv">{sl ?? '-'}</span></div>
        {tp1 != null && <div className="pill tp"><span className="pl">TAKE PROFIT 1</span><span className="pv">{tp1}</span></div>}
        {s.tp2 != null && <div className="pill tp"><span className="pl">TAKE PROFIT 2</span><span className="pv">{s.tp2}</span></div>}
      </div>
      {s.ai_note && <div className="sub" style={{ marginTop: 6, lineHeight: 1.45 }}>{s.ai_note}</div>}
      {s.win_rate != null && s.pf != null && <div className="sub" style={{ marginTop: 0 }}>Backtest: {Math.round(s.win_rate * 100)}% wins · profit factor {s.pf} · {s.bt_trades} trades</div>}
      <div className="foot2"><span>{note}{live && s.expires_at ? ` · valid for ${left(s.expires_at)}` : ''}</span><span>{ago(s.created_at)}</span></div>
    </div>
  )
}
