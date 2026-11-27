import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import AccountSize from './AccountSize'
import DailyPlan from './DailyPlan'
import { todayLagos } from './daily'
import type { DailyPlan as Plan } from './daily'
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
  const [mine, setMine] = useState<boolean | undefined>(undefined)
  const [account, setAccount] = useState<number | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const todayOk = !!plan && plan.date === todayLagos()
  useEffect(() => {
    supabase.from('user_settings').select('data').eq('user_id', uid).maybeSingle().then(({ data }) => {
      const d = (data?.data ?? {}) as Record<string, unknown>
      setMine(d.signals_on === true)
      setAccount(typeof d.account_usd === 'number' ? d.account_usd : null)
    })
  }, [uid, busy])
  // today's plan, read from its own table (one row per member per day)
  useEffect(() => {
    supabase.from('daily_plans').select('plan_date,lot,risk_pct').eq('user_id', uid).eq('plan_date', todayLagos()).maybeSingle().then(({ data }) => {
      setPlan(data ? { date: String(data.plan_date), lot: Number(data.lot), risk_pct: Number(data.risk_pct) } : null)
    })
  }, [uid])
  const toggle = async () => {
    setBusy(true); setErr('')
    const { data } = await supabase.auth.getSession()
    const action = mine ? 'receive_off' : 'receive_on'
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
      {account === null && <AccountSize uid={uid} current={null} onSaved={(n) => setAccount(n)} />}
      {account && !editing && (
        <div className="acct-chip">
          <span>Account <b>${account.toLocaleString('en-US')}</b> · risk 10% per trade (${(account * 0.1).toFixed(2)})</span>
          <button className="btn sm" onClick={() => setEditing(true)}>Change</button>
        </div>
      )}
      {editing && account && <AccountSize uid={uid} current={account} onSaved={(n) => { setAccount(n); setEditing(false) }} onClose={() => setEditing(false)} />}
      {account && !todayOk && <DailyPlan uid={uid} account={account} onSaved={(p) => setPlan(p)} />}
      <div className="card">
        <div className="row">
          <div>
            <b><span className={`dot ${mine ? '' : 'off'}`} />{mine ? 'Receiving signals' : 'Signals off for you'}</b>
            <div className="mu">{bot?.running && online ? 'Scanner running' : 'Scanner off'}</div>
          </div>
          {mine !== undefined && (
            <button className={`btn ${mine ? 'stop' : 'start'}`} onClick={toggle} disabled={busy || (!mine && !todayOk)}>
              <Icon n={mine ? 'stop' : 'play'} />{admin ? (mine ? 'Stop scanner' : 'Start scanner') : (mine ? 'Stop receiving' : 'Start receiving')}
            </button>
          )}
        </div>
        {admin && bot && (
          <div className="ml">
            <div className="row"><span className="mu">Strategies passed</span><b>{bot.approved ?? '-'} of {bot.combos ?? '-'}</b></div>
            <div className="row" style={{ marginTop: 6 }}><span className="mu">Signals today</span><b>{t.length}{t.some((s) => s.approved === false) ? ` (${t.filter((s) => s.approved === false).length} untested)` : ''}</b></div>
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
        {mine && !todayOk && <p className="mu">Enter today's lot size and risk above to see your signals.</p>}
        {mine && todayOk ? <div className="cards">{[...sigs].sort((a, b) => (b.symbol === 'XAUUSD' ? 1 : 0) - (a.symbol === 'XAUUSD' ? 1 : 0)).slice(0, 5).map((s) => <SignalCard key={s.id} s={s} account={account ?? undefined} plan={plan ?? undefined} />)}</div> : !mine ? <p className="mu">Signals are off for your account. Press Start scanner to receive them.</p> : null}
      </div>
    </>
  )
}
