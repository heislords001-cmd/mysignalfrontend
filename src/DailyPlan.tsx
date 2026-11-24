import { useState } from 'react'
import { supabase } from './supabase'
import { todayLagos } from './daily'
import type { DailyPlan as Plan } from './daily'

export const RISK_OPTIONS = [1, 2, 3, 5, 10]

// The daily discipline step: every day the member states the lot size and the risk they will use. Signals wait for it.
export default function DailyPlan({ uid, account, onSaved }: { uid: string; account: number; onSaved: (p: Plan) => void }) {
  const [lot, setLot] = useState('0.01')
  const [risk, setRisk] = useState(10)
  const [msg, setMsg] = useState('')
  const save = async () => {
    const l = Number(lot)
    if (!Number.isFinite(l) || l < 0.01 || l > 1) { setMsg('Lot size must be between 0.01 and 1.00.'); return }
    if (!RISK_OPTIONS.includes(risk)) { setMsg('Pick a risk from the list.'); return }
    const plan: Plan = { date: todayLagos(), lot: Math.round(l * 100) / 100, risk_pct: risk }
    const { data: cur } = await supabase.from('user_settings').select('data').eq('user_id', uid).maybeSingle()
    await supabase.from('user_settings').upsert({ user_id: uid, data: { ...((cur?.data ?? {}) as object), daily_plan: plan } }, { onConflict: 'user_id' })
    setMsg(''); onSaved(plan)
  }
  return (
    <div className="card">
      <h3>Today's plan</h3>
      <p className="mu">Before you receive signals today, state the lot size you will use and the risk per trade. This is set again every day.</p>
      <label className="mu" style={{ display: 'block', marginTop: 10 }}>Lot size</label>
      <input type="number" step="0.01" min="0.01" max="1" value={lot} onChange={(e) => setLot(e.target.value)} className="input" />
      <label className="mu" style={{ display: 'block', marginTop: 6 }}>Risk per trade</label>
      <div className="acct-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        {RISK_OPTIONS.map((r) => <button key={r} className={`acct-opt ${risk === r ? 'on' : ''}`} onClick={() => setRisk(r)}>{r}%</button>)}
      </div>
      <p className="mu" style={{ marginTop: 8 }}>Risk budget today: <b>${(account * risk / 100).toFixed(2)}</b> on a ${account.toLocaleString('en-US')} account.</p>
      <button className="btn p" style={{ marginTop: 8 }} onClick={save}>Save today's plan</button>
      {msg && <p className="mu" style={{ marginTop: 8 }}>{msg}</p>}
    </div>
  )
}
