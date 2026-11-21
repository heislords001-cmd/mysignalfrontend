import { useEffect, useState } from 'react'
import { supabase } from './supabase'

type Acct = { login: string; server: string; status: string; note: string | null; updated_at: string } | null

// The EA page: your MT5 demo login, and the EA download with its setup.
export default function Ea() {
  const [acct, setAcct] = useState<Acct>(null)
  const [login, setLogin] = useState('')
  const [server, setServer] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? ''
  const load = async () => {
    const res = await fetch('/api/system?op=mt5-account', { headers: { Authorization: `Bearer ${await token()}` } })
    const j = (await res.json().catch(() => ({}))) as { account?: Acct }
    setAcct(j.account ?? null)
  }
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t) }, [])
  const save = async () => {
    setBusy(true); setMsg('')
    const res = await fetch('/api/system?op=mt5-account', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ login, server, password }),
    })
    const j = (await res.json().catch(() => ({}))) as { note?: string; error?: string }
    setBusy(false)
    if (!res.ok) return setMsg(j.error ?? 'Could not save.')
    setPassword(''); setMsg(j.note ?? 'Saved.'); load()
  }
  return (
    <div>
      <div className="card">
        <h3>Your MT5 demo account</h3>
        <p className="mu">Enter your demo login. The password is stored encrypted and the VPS uses it to log in. It is never shown again.</p>
        {acct && <p className="mu"><b>Saved:</b> login {acct.login} on {acct.server} · status: {acct.status}{acct.note ? ` · ${acct.note}` : ''}</p>}
        <input placeholder="MT5 login (numbers)" value={login} onChange={(e) => setLogin(e.target.value)} className="input" />
        <input placeholder="Broker server, e.g. ExampleBroker-Demo" value={server} onChange={(e) => setServer(e.target.value)} className="input" />
        <input type="password" placeholder="MT5 password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
        <button className="btn" onClick={save} disabled={busy || !login || !server || !password}>{busy ? 'Saving...' : 'Save MT5 account'}</button>
        {msg && <p className="mu" style={{ marginTop: 8 }}>{msg}</p>}
      </div>
      <div className="card">
        <h3>Expert Advisor</h3>
        <p className="mu">The EA runs inside MT5 on the VPS. Download it here if you want to run it yourself.</p>
        <a className="btn" href="/downloads/FXDesk_Strategies.mq5" download>Download the EA (.mq5)</a>
      </div>
    </div>
  )
}
