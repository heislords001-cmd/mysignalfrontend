import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { day } from './ui'
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

export default function Profile({ profile, sub, botAccess, refresh }: { profile: P; sub: Sub | null; botAccess: boolean; refresh: () => void }) {
  const admin = profile.role === 'admin'
  const [tab, setTab] = useState<'plan' | 'pay' | 'bot' | 'set'>('plan')
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
  const tabs: ['plan' | 'pay' | 'bot' | 'set', string][] = [['plan', 'Plan'], ['pay', 'Payments'], ['bot', 'Bot access'], ...(botAccess ? [['set', 'Settings'] as ['set', string]] : [])]
  const online = !!acct?.updated_at && Date.now() - new Date(acct.updated_at).getTime() < 30000
  return (
    <>
      <div className="card row"><div><b>{profile.email}</b><div className="mu">{admin ? 'Admin' : 'Member'}</div></div>
        <span className={activeNow || admin ? 'ok' : 'mu'}>{admin ? 'Full access' : activeAuto ? 'Auto-trading · active' : activeNow ? 'Signals · active' : 'No active plan'}</span></div>
      <div className="seg">{tabs.map(([k, l]) => <button key={k} className={`btn sm ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {msg && <div className="card"><span className="mu">{msg}</span></div>}

      {tab === 'plan' && <>
        {(['signals', 'auto'] as PlanId[]).map((id) => {
          const mine = activeNow && sub?.plan === id
          return (
            <div className="card" key={id}><h3>{PLANS[id].name}{mine && <span className="tg">your plan</span>}</h3>
              <div className="price">{naira(PLANS[id].price)}<small> / {PLANS[id].days} days</small></div>
              {mine && sub && <p className="mu">Active until {day(sub.expires_at)}</p>}
              <p><button className="btn p" disabled={id === 'signals' && activeAuto} onClick={() => pay(id)}>{mine ? 'Renew' : id === 'auto' && activeNow ? 'Upgrade' : 'Get access'}</button></p></div>
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
          <ol className="mu"><li>Log in to MT5 on your PC (start with a demo account)</li><li>Unzip the bot, rename env.example to .env and fill it in</li><li>Run pip install -r requirements.txt, then python bot.py</li><li>Open the Bot tab and turn it on</li></ol></>
          : <><p className="mu">Auto-trading is part of the Signals + Auto-trading plan.</p><button className="btn p" onClick={() => setTab('plan')}>See plans</button></>}</div>}

      {tab === 'set' && botAccess && <Settings uid={profile.id} admin={admin} />}
    </>
  )
}
