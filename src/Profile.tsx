import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { ago, day } from './ui'
import { PLANS, naira } from './plans'
import type { PlanId } from './plans'
import { DEFAULTS, SMALL } from './types'
import type { BotAccount, Cfg, Payment, Profile as P, Sub } from './types'

declare global { interface Window { PaystackPop?: { setup(o: Record<string, unknown>): { openIframe(): void } } } }
const loadPaystack = () => new Promise<void>((ok, fail) => {
  if (window.PaystackPop) return ok()
  const s = document.createElement('script')
  s.src = 'https://js.paystack.co/v1/inline.js'
  s.onload = () => ok()
  s.onerror = () => fail(new Error('Could not load Paystack'))
  document.head.appendChild(s)
})

const SCAN_FIELDS: [string, string, number][] = [
  ['adx_min', 'Minimum trend strength (ADX)', 1], ['scalp_tp_atr', 'Scalp take-profit (× ATR)', 0.1], ['runner_sl_atr', 'Runner stop loss (× ATR)', 0.1],
  ['session_start_utc', 'Bot trading window start (UTC hour)', 1], ['session_end_utc', 'Bot trading window end (UTC hour)', 1],
]
const LIMIT_FIELDS: [string, string, number][] = [
  ['scalp_target', 'Max scalps per pair', 1], ['runner_max', 'Max runners per pair', 1], ['max_lot_per_trade', 'Max lot per trade', 0.01],
  ['max_total_lots', 'Max total lots', 0.01], ['basket_stop_pct', 'Basket stop (% of balance)', 0.5], ['daily_loss_pct', 'Daily loss limit (%)', 0.5],
]
const SMALL_FIELDS: [string, string, number][] = [['risk_budget_pct', 'Risk budget (% of equity)', 1], ['hard_stop_atr', 'Scalp emergency stop (× ATR)', 0.1], ['margin_use_max_pct', 'Max margin used (%)', 5]]
const LIMIT_KEYS = [...LIMIT_FIELDS, ...SMALL_FIELDS].map((f) => f[0]).concat('small_account')

function Settings({ uid, admin }: { uid: string; admin: boolean }) {
  const [cfg, setCfg] = useState<Cfg>(DEFAULTS)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    Promise.all([supabase.from('settings').select('data').eq('id', 1).maybeSingle(), supabase.from('user_settings').select('data').eq('user_id', uid).maybeSingle()])
      .then(([g, u]) => setCfg({ ...DEFAULTS, ...(g.data?.data as Cfg | undefined), ...(u.data?.data as Cfg | undefined) }))
  }, [uid])
  const small = !!cfg.small_account
  const flip = (on: boolean) => setCfg(on ? { ...cfg, ...SMALL } : { ...cfg, small_account: false, scalp_target: 6, runner_max: 3, max_lot_per_trade: 0.1, max_total_lots: 3, basket_stop_pct: 3, daily_loss_pct: 3 })
  const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, cfg[k]]))
  const save = async (e: FormEvent) => {
    e.preventDefault()
    const a = await supabase.from('user_settings').upsert({ user_id: uid, data: pick(LIMIT_KEYS) }, { onConflict: 'user_id' })
    const b = admin ? await supabase.from('settings').update({ data: pick(SCAN_FIELDS.map((f) => f[0])) }).eq('id', 1) : null
    const error = a.error ?? b?.error
    setMsg(error ? error.message : 'Saved. Your bot picks this up within about 30 seconds.')
  }
  const field = ([k, label, step]: [string, string, number]) => (
    <label className="f" key={k}>{label}<input type="number" step={step} value={Number(cfg[k])} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} required /></label>
  )
  return (
    <form className="card" onSubmit={save}>
      <h3>Bot settings</h3>
      <div className="sw"><span>Small account mode<div className="mu">Stops on every trade, risk budget, margin cap</div></span><input type="checkbox" checked={small} onChange={(e) => flip(e.target.checked)} /></div>
      <div className="form ml">{LIMIT_FIELDS.map(field)}{small && SMALL_FIELDS.map(field)}</div>
      {admin && <><h3 className="ml">Strategy (applies to everyone)</h3><div className="form">{SCAN_FIELDS.map(field)}</div></>}
      <p className="row"><span className={msg.startsWith('Saved') ? 'mu' : 'err'}>{msg}</span><button className="btn p" type="submit">Save settings</button></p>
    </form>
  )
}

type Health = {
  env: Record<string, boolean>; tables?: Record<string, string>; migration2?: boolean; websocket?: boolean; note?: string
  scanner?: { running: boolean; heartbeat: string | null; last_error: string | null; approved: number | null; combos: number | null; note: string | null } | null
}
const checks = (h: Health): [string, boolean, string][] => {
  const out: [string, boolean, string][] = [
    ['Vercel setting SUPABASE_URL', !!h.env.SUPABASE_URL, 'Add it in Vercel as a Secret, then press Redeploy.'],
    ['Vercel setting SUPABASE_SERVICE_KEY', !!h.env.SUPABASE_SERVICE_KEY, 'Add it in Vercel as a Secret, then press Redeploy.'],
    ['Vercel setting TOKEN_ENCRYPTION_KEY', !!h.env.TOKEN_ENCRYPTION_KEY && !!h.env.TOKEN_ENCRYPTION_KEY_VALID, h.env.TOKEN_ENCRYPTION_KEY ? 'It must be exactly 64 characters: numbers 0-9 and letters a-f.' : 'Add it in Vercel as a Secret, then press Redeploy.'],
    ['Vercel setting WEBHOOK_SECRET', !!h.env.WEBHOOK_SECRET, 'Needed so the bot can place trades. Add it, then Redeploy.'],
  ]
  if (h.tables) {
    out.push(['Database: migration-2 applied', !!h.migration2, 'Run migration-2.sql in the Supabase SQL Editor.'])
    out.push(['Database: key storage tables', h.tables.broker_links === 'ok' && h.tables.broker_secrets === 'ok', 'Run migration-2.sql in the Supabase SQL Editor.'])
    out.push(['Database: trade records (migration-3)', h.tables.executions === 'ok', 'Run migration-3.sql in the Supabase SQL Editor.'])
    out.push(['Server can check Deriv keys live', !!h.websocket, 'Optional. Keys still save, marked "not checked".'])
  }
  return out
}

export function SystemCheck() {
  const [h, setH] = useState<Health | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true); setMsg('')
    const { data } = await supabase.auth.getSession()
    const res = await fetch('/api/health', { headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } })
    const out = (await res.json().catch(() => null)) as (Health & { error?: string }) | null
    setBusy(false)
    if (!out || (!res.ok && !out.env)) { setMsg(out?.error ?? (res.status === 404 ? 'The check is not on your site yet. Upload the latest website files and redeploy.' : `The check failed (status ${res.status}).`)); return }
    setH(out)
  }
  const sc = h?.scanner
  return (
    <div className="card ml"><div className="row"><h3 style={{ margin: 0 }}>System check</h3><button className="btn sm" disabled={busy} onClick={run}>{busy ? 'Checking...' : 'Run check'}</button></div>
      {msg && <p className="err">{msg}</p>}
      {h?.note && <p className="mu">{h.note}</p>}
      {h && checks(h).map(([label, ok, fix]) => (
        <div key={label} style={{ marginTop: 10 }}><div className="row"><span>{label}</span><b className={ok ? 'ok' : 'neg'}>{ok ? 'OK' : 'Fix'}</b></div>{!ok && <div className="mu">{fix}</div>}</div>
      ))}
      {sc && <div style={{ marginTop: 14 }}><div className="row"><span>Scanner</span><b>{sc.running ? 'On' : 'Paused'}</b></div>
        <div className="mu">Last check {sc.heartbeat ? ago(sc.heartbeat) : 'never'}{sc.combos != null ? ` · ${sc.approved ?? 0} of ${sc.combos} strategies passed` : ''}</div>
        {sc.last_error && <div className="err">{sc.last_error}</div>}</div>}
    </div>
  )
}


// Signals API: the member makes their own key here, and uses it from their own program.
export function ApiAccess() {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/signals` : '/api/signals'
  const call = async (action: 'new' | 'revoke') => {
    setBusy(true); setNote(''); setKey('')
    const { data } = await supabase.auth.getSession()
    const res = await fetch('/api/system?op=signals-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify({ action }),
    })
    const j = (await res.json().catch(() => ({}))) as { key?: string; note?: string; error?: string }
    setBusy(false)
    if (!res.ok) return setNote(j.error ?? 'Could not do that. Try again.')
    if (j.key) setKey(j.key)
    setNote(j.note ?? '')
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(key); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }
  return (
    <div className="card">
      <h3>Signals API</h3>
      <p className="mu">Get the latest signals in your own program. Each signal says whether it passed the test (approved: true) or is untested (approved: false).</p>
      <p className="mu"><b>Address:</b></p>
      <pre className="code">{url}</pre>
      <p className="mu"><b>Example</b> (replace YOUR_KEY). Add <code>?approved_only=1</code> to get only the signals that passed the test:</p>
      <pre className="code">{`curl -H "Authorization: Bearer YOUR_KEY" "${url}"`}</pre>
      <button className="btn" onClick={() => call('new')} disabled={busy}>{busy ? 'Working...' : 'Create my key'}</button>
      {key && <>
        <p className="mu" style={{ marginTop: 10 }}><b>Your key</b> (copy it now, it is shown only once):</p>
        <pre className="code" style={{ wordBreak: 'break-all' }}>{key}</pre>
        <button className="btn sm" onClick={copy}>{copied ? 'Copied' : 'Copy key'}</button>
      </>}
      {note && <p className="mu" style={{ marginTop: 8 }}>{note}</p>}
      <p className="mu" style={{ marginTop: 8 }}>Creating a new key replaces the old one. <button className="btn sm stop" onClick={() => call('revoke')} disabled={busy}>Revoke my key</button></p>
    </div>
  )
}


// The Signals API docs, shown on their own tab in Profile.
export function ApiDocs() {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://mysignalfrontend.vercel.app'
  const sig = `${base}/api/signals`
  const ctl = `${base}/api/scanner-control`
  return (
    <div className="card">
      <h3>How to use the Signals API</h3>
      <p className="mu">Create your key above, then use it from your own program. Keep the key private: anyone with it can read your signals.</p>

      <h3 style={{ marginTop: 14 }}>1. Check if the scanner is running</h3>
      <p className="mu">Ask first. If it is running, do not start it again: it is already dropping signals, so just read them.</p>
      <pre className="code">{`curl -H "Authorization: Bearer YOUR_KEY" "${ctl}"`}</pre>

      <h3 style={{ marginTop: 14 }}>2. Start it only if it is not running</h3>
      <pre className="code">{`curl -X POST -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"action":"receive_on"}' "${ctl}"`}</pre>
      <p className="mu">If it is already running, this connects you to the same run. No new scanner is started. A run lasts up to about 5.5 hours, so check again when it stops.</p>

      <h3 style={{ marginTop: 14 }}>3. Read the signals</h3>
      <pre className="code">{`curl -H "Authorization: Bearer YOUR_KEY" "${sig}"`}</pre>
      <p className="mu">Add <code>?approved_only=1</code> to get only the signals that passed the test. Without it you also get untested signals, marked approved: false.</p>

      <h3 style={{ marginTop: 14 }}>Python</h3>
      <pre className="code">{`import requests

KEY = "YOUR_KEY"
H = {"Authorization": f"Bearer {KEY}"}

status = requests.get("${ctl}", headers=H, timeout=20).json()
if not status["running"]:
    requests.post("${ctl}", headers=H, json={"action": "receive_on"}, timeout=60)

data = requests.get("${sig}", headers=H, params={"approved_only": 1}, timeout=20).json()
for s in data["signals"]:
    print(s["symbol"], s["side"], s["entry"], s["sl"], s["tp1"], "approved" if s["approved"] else "untested")`}</pre>

      <h3 style={{ marginTop: 14 }}>What a signal contains</h3>
      <p className="mu">symbol, side (buy or sell), timeframe, strategy, entry, sl (stop loss), tp1 and tp2 (targets), approved (true if it passed the test), agreement (higher timeframes), risk_warning (set when the stop costs more than your budget at the smallest lot), created_at and expires_at. Only the last 24 hours are returned, up to 30 at a time.</p>

      <h3 style={{ marginTop: 14 }}>Errors</h3>
      <p className="mu">401: the key is missing or wrong. Create a new one above. 403: your plan is not active. 405: wrong method, use GET for reading and POST for starting.</p>

      <div className="card warn" style={{ marginTop: 14 }}>
        <p className="mu"><b>Untested signals have lost money in every backtest so far.</b> If your program trades from this feed, use <code>approved_only=1</code>.</p>
      </div>
    </div>
  )
}

export default function Profile({ profile, sub, botAccess, refresh, paymentsOn, setPaymentsOn }: { profile: P; sub: Sub | null; botAccess: boolean; refresh: () => void; paymentsOn: boolean; setPaymentsOn: (v: boolean) => void }) {
  const admin = profile.role === 'admin'
  const [tab, setTab] = useState<'plan' | 'pay' | 'bot' | 'set' | 'api'>('plan')
  const [pays, setPays] = useState<Payment[]>([])
  const [acct, setAcct] = useState<BotAccount | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    supabase.from('payments').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(50).then(({ data }) => data && setPays(data as Payment[]))
    if (botAccess) supabase.from('bot_account').select('*').eq('user_id', profile.id).maybeSingle().then(({ data }) => data && setAcct(data as BotAccount))
  }, [profile.id, botAccess, sub])

  const verify = async (reference: string, plan: PlanId) => {
    setMsg('Confirming your payment...')
    const { data } = await supabase.auth.getSession()
    const res = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` }, body: JSON.stringify({ reference, plan }) })
    const out = await res.json().catch(() => ({}))
    setMsg(res.ok ? 'Payment confirmed. Your access is active.' : `Could not confirm payment: ${out.error ?? res.status}. Keep your reference: ${reference}`)
    refresh()
  }
  const pay = async (plan: PlanId) => {
    const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string | undefined
    if (!key) return setMsg('Payments are not set up yet.')
    try { await loadPaystack() } catch (e) { return setMsg((e as Error).message) }
    window.PaystackPop!.setup({
      key, email: profile.email, amount: PLANS[plan].price * 100, currency: 'NGN', ref: `fx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      callback: (r: { reference: string }) => { verify(r.reference, plan) }, onClose: () => {},
    }).openIframe()
  }

  const activeNow = !!sub && new Date(sub.expires_at) > new Date()
  const activeAuto = activeNow && sub?.plan === 'auto'
  const FREE = !paymentsOn
  const isAdmin = profile.role === 'admin'
  const [switchMsg, setSwitchMsg] = useState('')
  const flipPayments = async () => {
    const { data } = await supabase.auth.getSession()
    const res = await fetch('/api/system?op=payments', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` }, body: JSON.stringify({ on: !paymentsOn }) })
    const j = (await res.json().catch(() => ({}))) as { payments_on?: boolean; note?: string; error?: string }
    if (res.ok) { setPaymentsOn(!!j.payments_on); setSwitchMsg(j.note ?? '') } else setSwitchMsg(j.error ?? 'Could not switch payments.')
  }
  const tabs: ['plan' | 'pay' | 'bot' | 'set' | 'api', string][] = [['plan', 'Plan'], ...(FREE ? [] : [['pay', 'Payments'] as ['pay', string]]), ['bot', 'Bot access'], ['api', 'Signals API'], ...(botAccess ? [['set', 'Settings'] as ['set' | 'api', string]] : [])]
  const online = !!acct?.updated_at && Date.now() - new Date(acct.updated_at).getTime() < 30000
  return (
    <>
      <div className="card row"><div><b>{profile.email}</b><div className="mu">{admin ? 'Admin' : 'Member'}</div></div>
        <span className={activeNow || admin ? 'ok' : 'mu'}>{admin ? 'Full access' : activeAuto ? 'Auto-trading · active' : activeNow ? 'Signals · active' : 'No active plan'}</span></div>
      <div className="seg">{tabs.map(([k, l]) => <button key={k} className={`btn sm ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {msg && <div className="card"><span className="mu">{msg}</span></div>}
      {tab === 'api' && <><ApiAccess /><ApiDocs /></>}

      {tab === 'plan' && isAdmin && <div className="card"><b>Payments: {paymentsOn ? 'ON' : 'OFF'}</b><div className="mu" style={{ marginTop: 4 }}>Off: everyone who signs in has free access. On: plans apply. Turning it on keeps every existing account free.</div><button className="btn" style={{ marginTop: 8 }} onClick={flipPayments}>Turn payments {paymentsOn ? 'off' : 'on'}</button>{switchMsg && <div className="mu" style={{ marginTop: 6 }}>{switchMsg}</div>}</div>}
      {tab === 'plan' && FREE && <div className="card"><b>Free access for now</b><div className="mu">Payments are paused. Everyone who signs in has full access.</div></div>}
      {tab === 'plan' && !FREE && <>
        {(['signals', 'auto'] as PlanId[]).map((id) => {
          const mine = activeNow && sub?.plan === id
          return (
            <div className={`card${id === 'auto' ? ' feat' : ''}`} key={id}><h3>{PLANS[id].name}{mine && <span className="tg">your plan</span>}</h3>
              <div className="price">{naira(PLANS[id].price)}<small> / {PLANS[id].days} days</small></div>
              {mine && sub && <p className="mu">Active until {day(sub.expires_at)}</p>}
              <p><button className={`btn ${id === 'auto' ? 'brown' : 'p'}`} disabled={id === 'signals' && activeAuto} onClick={() => pay(id)}>{mine ? 'Renew' : id === 'auto' && activeNow ? 'Upgrade' : 'Get access'}</button></p></div>
          )
        })}
        <p className="mu">Paying again adds days to what you have left. Upgrading keeps your remaining days.</p></>}

      {tab === 'pay' && <div className="card"><h3>Payment records</h3>
        {pays.length === 0 ? <p className="mu">No payments yet.</p> : <table><tbody><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr>
          {pays.map((p) => <tr key={p.id}><td>{day(p.created_at)}</td><td>{p.plan}</td><td>{naira(p.amount)}</td><td className="ok">{p.status === 'success' ? 'Paid' : p.status}</td></tr>)}</tbody></table>}</div>}

      {tab === 'bot' && <div className="card"><h3>Bot access</h3>
        {botAccess ? <>
          <div className="row"><span className="mu">Your bot</span><b className={online ? 'ok' : 'neg'}>{online ? 'Online' : 'Offline'}</b></div>
          <p className="mu">Connect your Deriv account by pasting your Deriv API key in the Bot tab. Advanced option: you can instead run the MT5 bot on your own Windows PC, using the download below.</p>
          <p><a className="btn p" href="/fx-bot.zip" download>Download the bot</a></p>
          <ol className="mu"><li>Log in to MT5 on your PC (start with a demo account)</li><li>Unzip the bot, rename env.example to .env and fill it in</li><li>Run pip install -r requirements.txt, then python bot.py</li><li>Open the Bot tab and turn it on</li></ol>
          {admin && <SystemCheck />}</>
          : <><p className="mu">Auto-trading is part of the Signals + Auto-trading plan.</p><button className="btn p" onClick={() => setTab('plan')}>See plans</button></>}</div>}

      {tab === 'set' && botAccess && <Settings uid={profile.id} admin={admin} />}
    </>
  )
}
