import { useState } from 'react'
import { supabase } from './supabase'

export const ACCOUNT_OPTIONS = [10, 25, 50, 100, 250, 500, 1000]

// Asks the member how big their account is. Signal sizes and the risk shown on each card follow this.
export default function AccountSize({ uid, current, onSaved, onClose }: { uid: string; current: number | null; onSaved: (n: number) => void; onClose?: () => void }) {
  const [custom, setCustom] = useState('')
  const [msg, setMsg] = useState('')
  const save = async (amount: number) => {
    if (!Number.isFinite(amount) || amount < 10) { setMsg('The smallest account is $10.'); return }
    const { data: cur } = await supabase.from('user_settings').select('data').eq('user_id', uid).maybeSingle()
    const { error } = await supabase.from('user_settings').upsert({ user_id: uid, data: { ...((cur?.data ?? {}) as object), account_usd: amount } }, { onConflict: 'user_id' })
    if (error) { setMsg(`Not saved: ${error.message}. Run migration-16 in Supabase.`); return }
    setMsg(''); setCustom(''); onSaved(amount)
  }
  return (
    <div className="card">
      <h3>{current ? 'Change your account size' : 'How big is your account?'}</h3>
      <p className="mu">Your signals are sized to this amount, so each one shows the lot size and the risk for your account.</p>
      <div className="acct-grid">
        {ACCOUNT_OPTIONS.map((n) => (
          <button key={n} className={`acct-opt ${current === n ? 'on' : ''}`} onClick={() => save(n)}>${n.toLocaleString('en-US')}</button>
        ))}
      </div>
      <p className="mu" style={{ marginTop: 10 }}>Bigger account? Enter the amount in USD:</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="number" min={10} placeholder="Amount in USD" value={custom} onChange={(e) => setCustom(e.target.value)} className="input" style={{ margin: 0 }} />
        <button className="btn p" onClick={() => save(Number(custom))} disabled={!custom}>Save</button>
      </div>
      {msg && <p className="mu" style={{ marginTop: 8 }}>{msg}</p>}
      {current && onClose && <button className="btn sm" style={{ marginTop: 10 }} onClick={onClose}>Close</button>}
    </div>
  )
}
