import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Icon, Locked, SignalCard, ago } from './ui'
import type { ScannerState, Signal } from './types'

export default function Home({ admin, access, goPlan }: { admin: boolean; access: boolean; goPlan: () => void }) {
  const [bot, setBot] = useState<ScannerState | null>(null)
  const [sigs, setSigs] = useState<Signal[]>([])
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    if (!access) return
    const [b, s] = await Promise.all([
      supabase.from('scanner_state').select('*').eq('id', 1).maybeSingle(),
      supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(50),
    ])
    if (b.data) setBot(b.data as ScannerState)
    if (s.data) setSigs(s.data as Signal[])
  }, [access])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const toggle = async () => {
    if (!bot) return
    const { error } = await supabase.from('scanner_state').update({ running: !bot.running }).eq('id', 1)
    setErr(error ? error.message : '')
    load()
  }
  if (!access) return <Locked go={goPlan} />
  const today = new Date().toISOString().slice(0, 10)
  const t = sigs.filter((s) => s.created_at.startsWith(today))
  const online = !!bot?.heartbeat && Date.now() - new Date(bot.heartbeat).getTime() < 1200000
  return (
    <>
      <div className="card">
        <div className="row">
          <div>
            <b><span className={`dot ${online ? '' : 'off'}`} />{bot?.running ? 'Scanner running' : 'Scanner paused'}</b>
            <div className="mu">{online ? `Last check ${ago(bot?.heartbeat ?? null)}` : 'Scanner worker offline'}{bot?.running ? ' · checks every candle close, Mon to Fri' : ''}</div>
          </div>
          {admin && bot && (
            <button className={`btn ${bot.running ? 'stop' : 'p'}`} onClick={toggle}>
              <Icon n={bot.running ? 'stop' : 'play'} />{bot.running ? 'Stop scanner' : 'Start scanner'}
            </button>
          )}
        </div>
        {bot?.last_error && admin && <p className="err">Last error: {bot.last_error}</p>}
        {err && <p className="err">{err}</p>}
      </div>
      <div className="stats">
        <div className="stat"><span className="mu">Today</span><b>{t.length}</b></div>
        <div className="stat"><span className="mu">Buy</span><b>{t.filter((s) => s.side === 'buy').length}</b></div>
        <div className="stat"><span className="mu">Sell</span><b>{t.filter((s) => s.side === 'sell').length}</b></div>
      </div>
      <div className="card"><h2>Latest signals</h2>
        {sigs.length === 0 && <p className="mu">No signals yet. They appear when an approved strategy finds a setup.</p>}
        <div className="cards">{sigs.slice(0, 5).map((s) => <SignalCard key={s.id} s={s} />)}</div>
      </div>
    </>
  )
}
