import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Locked, SignalRow, STRAT, ago } from './ui'
import type { Signal, StratStat } from './types'

export default function Signals({ access, goPlan }: { access: boolean; goPlan: () => void }) {
  const [sigs, setSigs] = useState<Signal[]>([])
  const [stats, setStats] = useState<StratStat[]>([])
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all')
  const [tf, setTf] = useState('all')
  const [info, setInfo] = useState(false)
  useEffect(() => {
    if (!access) return
    const load = () => supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(200).then(({ data }) => data && setSigs(data as Signal[]))
    load()
    supabase.from('strategy_stats').select('*').order('pf', { ascending: false }).then(({ data }) => data && setStats(data as StratStat[]))
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [access])
  if (!access) return <Locked go={goPlan} />

  const list = sigs.filter((s) => (side === 'all' || s.side === side) && (tf === 'all' || s.timeframe === tf))
  const month = Date.now() - 30 * 86400000
  const done = sigs.filter((s) => s.outcome && s.result_r != null && new Date(s.created_at).getTime() > month)
  const wins = done.filter((s) => s.outcome === 'tp').length
  const avgR = done.length ? done.reduce((a, s) => a + (s.result_r ?? 0), 0) / done.length : 0
  const approved = stats.filter((s) => s.enabled)
  return (
    <>
      <div className="seg">
        {['all', 'M5', 'M15', 'H1'].map((k) => <button key={k} className={`btn sm ${tf === k ? 'on' : ''}`} onClick={() => setTf(k)}>{k === 'all' ? 'All timeframes' : k}</button>)}
        {(['all', 'buy', 'sell'] as const).map((k) => <button key={k} className={`btn sm ${side === k ? 'on' : ''}`} onClick={() => setSide(k)}>{k === 'all' ? 'Buy + Sell' : k === 'buy' ? 'Buy' : 'Sell'}</button>)}
      </div>
      <div className="card">
        {list.length === 0 && <p className="mu">Nothing here yet.</p>}
        {list.map((s) => <SignalRow key={s.id} s={s} />)}
      </div>
      <div className="card"><h3>Live results, last 30 days</h3>
        {done.length === 0 ? <p className="mu">No finished signals yet. Results appear once signals hit their target or stop.</p> : <>
          <div className="stats"><div className="stat"><span className="mu">Finished</span><b>{done.length}</b></div>
            <div className="stat"><span className="mu">Hit target</span><b>{Math.round((wins / done.length) * 100)}%</b></div>
            <div className="stat"><span className="mu">Average</span><b className={avgR >= 0 ? 'ok' : 'neg'}>{avgR >= 0 ? '+' : ''}{avgR.toFixed(2)}R</b></div></div>
          <p className="mu">R is your risk on a trade: -1R is a full stop-loss, +1.5R is TP1. Measured on the signals above, before your broker's spread.</p></>}
      </div>
      <div className="card"><div className="row"><h3 style={{ margin: 0 }}>How signals are picked</h3><button className="btn sm" onClick={() => setInfo(!info)}>{info ? 'Hide' : 'Show'}</button></div>
        {info && <>
          <p className="mu">The bot checks every candle close, Monday to Friday, on three timeframes: M5, M15 and H1. Each one has a bigger trend above it (H1, H4 and D1) that must agree.</p>
          <p className="mu"><b>Trend pullback:</b> the bigger trend is up (or down), price dips back to its 50-period average, and a candle closes back in the trend direction.</p>
          <p className="mu"><b>Structure retest:</b> price breaks the last swing high (or low), comes back to retest that level, and holds it.</p>
          <p className="mu">Every day the bot backtests each strategy on each pair and timeframe, on data it was not tuned on, and only sends signals from combinations that passed. Past results do not promise future ones.</p>
          <h3 className="ml">Approved right now</h3>
          {approved.length === 0 ? <p className="mu">No combination has passed yet, so no signals are being sent.</p> :
            <table><tbody><tr><th>Pair</th><th>Time</th><th>Strategy</th><th>Wins</th><th>PF</th></tr>
              {approved.map((s) => <tr key={`${s.symbol}${s.timeframe}${s.strategy}`}><td>{s.symbol}</td><td>{s.timeframe}</td><td>{STRAT[s.strategy] ?? s.strategy}</td><td>{Math.round(s.win_rate * 100)}%</td><td>{s.pf}</td></tr>)}</tbody></table>}
          {stats[0] && <p className="mu">{approved.length} of {stats.length} combinations approved. Last tested {ago(stats.reduce((m, s) => (s.updated_at > m ? s.updated_at : m), stats[0].updated_at))}.</p>}
        </>}
      </div>
    </>
  )
}
