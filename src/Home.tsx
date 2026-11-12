import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Icon, Locked, SignalCard, ago } from './ui'
import type { ScannerState, Signal } from './types'
import { EquityChart } from './Bot'

export default function Home({ uid, admin, access, goPlan }: { uid: string; admin: boolean; access: boolean; goPlan: () => void }) {
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

  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    if (!bot) return
    setBusy(true); setErr('')
    const { data } = await supabase.auth.getSession()
    const action = bot.running ? 'stop' : 'start'
    const res = await fetch('/api/scanner-control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify({ action }),
    })
    const out = (await res.json().catch(() => ({}))) as { error?: string; note?: string }
    setBusy(false)
    if (!res.ok) setErr(out.error ?? `Could not ${action} the scanner (status ${res.status}).`)
    else if (out.note) setErr(out.note)
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
            <div className="mu">{online ? `Last check ${ago(bot?.heartbeat ?? null)}` : 'Scanner worker offline'}{bot?.running ? ' · runs until you press Stop' : ''}</div>
          </div>
          {admin && bot && (
            <button className={`btn ${bot.running ? 'stop' : 'start'}`} onClick={toggle} disabled={busy}>
              <Icon n={bot.running ? 'stop' : 'play'} />{bot.running ? 'Stop scanner' : 'Start scanner'}
            </button>
          )}
        </div>
        {admin && bot && (
          <div className="ml">
            <div className="row"><span className="mu">Strategies passed</span><b>{bot.approved ?? '-'} of {bot.combos ?? '-'}</b></div>
            <div className="row" style={{ marginTop: 6 }}><span className="mu">Signals today</span><b>{t.length}{t.some((s) => s.approved === false) ? ` (${t.filter((s) => s.approved === false).length} untested)` : ''}</b></div>
            {bot.note && <p className="mu">{bot.note}</p>}
            {!bot.running && <p className="mu">The scanner is off. Press Start scanner and it runs on GitHub until you press Stop, or for up to 5.5 hours, or until forex closes. Nothing runs in the background.</p>}
          </div>
        )}
        {bot?.last_error && admin && <p className="err">Last error: {bot.last_error}</p>}
        {err && <p className="err">{err}</p>}
      </div>
      <div className="stats">
        <div className="stat"><span className="mu">Today</span><b>{t.length}</b></div>
        <div className="stat"><span className="mu">Buy</span><b>{t.filter((s) => s.side === 'buy').length}</b></div>
        <div className="stat"><span className="mu">Sell</span><b>{t.filter((s) => s.side === 'sell').length}</b></div>
      </div>
      {bot?.running && <EquityChart uid={uid} />}
      <div className="card"><h2>Latest signals</h2>
        {sigs.length === 0 && <p className="mu">No signals yet. They appear when an approved strategy finds a setup.</p>}
        <div className="cards">{sigs.slice(0, 5).map((s) => <SignalCard key={s.id} s={s} />)}</div>
      </div>
    </>
  )
}
