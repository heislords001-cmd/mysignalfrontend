import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { Locked, ago, usd } from './ui'
import { DEFAULTS } from './types'
import type { BotAccount, BotPos, BotState, BrokerLink, Cfg } from './types'

type Exec = { id: number; status: string; message: string | null; stake: number | null; stop_loss: number | null; take_profit: number | null; created_at: string; signals: { symbol: string; side: string; timeframe: string | null } | null }

const Bar = ({ label, text, v, max }: { label: string; text: string; v: number; max: number }) => {
  const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0
  return <><div className="row"><span>{label}</span><span className="mu">{text}</span></div><div className={`pg ${pct >= 80 ? 'hot' : ''}`}><span style={{ width: `${pct}%` }} /></div></>
}

export function DerivLink({ uid, onLink }: { uid: string; onLink?: (l: BrokerLink | null) => void }) {
  const [link, setLink] = useState<BrokerLink | null | undefined>(undefined)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { supabase.from('broker_links').select('*').eq('user_id', uid).maybeSingle().then(({ data }) => setLink((data as BrokerLink | null) ?? null)) }, [uid])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (link !== undefined) onLink?.(link) }, [link, onLink])
  const call = async (method: 'POST' | 'DELETE', body?: object) => {
    const { data } = await supabase.auth.getSession()
    const res = await fetch('/api/deriv-link', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` }, body: body ? JSON.stringify(body) : undefined })
    const out = (await res.json().catch(() => ({}))) as { error?: string; status?: string; note?: string }
    if (!res.ok && !out.error) out.error = res.status === 404 ? 'The server function is not on your site yet. Upload the latest website files and redeploy.' : `The server answered with an error (status ${res.status}). The admin can run Profile, Bot access, System check to see what is missing.`
    return { ok: res.ok, out }
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg('')
    const { ok, out } = await call('POST', { token: key })
    setBusy(false); setBad(!ok)
    if (ok) { setKey(''); setMsg(out.status === 'verified' ? 'Connected.' : `Saved, but not checked yet. ${out.note ?? ''}`); load() } else setMsg(out.error ?? 'Could not save the key.')
  }
  const remove = async () => { setBusy(true); await call('DELETE'); setBusy(false); setMsg('Key removed.'); setBad(false); load() }
  if (link === undefined) return null
  if (link) return (
    <div className="card">
      <div className="row"><h3 style={{ margin: 0 }}>Deriv account</h3><span className={link.status === 'verified' ? 'ok' : 'mu'}>{link.status === 'verified' ? 'Connected' : 'Saved, not checked'}</span></div>
      <div className="row ml"><span className="mu">Account</span><b>{link.loginid ?? 'not read yet'}{link.is_virtual != null && <span className="tg">{link.is_virtual ? 'Demo' : 'Real'}</span>}</b></div>
      <p className="mu">Your key is saved encrypted on our server and is never shown again. When the bot is on, it places each approved signal as a trade on this account. Demo accounts only for now.</p>
      {msg && <p className={bad ? 'err' : 'mu'}>{msg}</p>}
      <button className="btn sm" disabled={busy} onClick={remove}>Remove key</button>
    </div>
  )
  return (
    <form className="card" onSubmit={save}>
      <h3>Connect your Deriv account</h3>
      <p className="mu">Paste your Deriv API key so the bot can trade for you.</p>
      <ol className="mu">
        <li>In Deriv, open Settings, then API token.</li>
        <li>Tick only <b>Read</b> and <b>Trade</b>. Never Payments or Admin.</li>
        <li>Start with a <b>demo</b> account.</li>
        <li>Copy the token and paste it here.</li>
      </ol>
      <label className="f">Deriv API key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" required /></label>
      {msg && <p className={bad ? 'err' : 'mu'}>{msg}</p>}
      <p style={{ marginBottom: 0 }}><button className="btn brown" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save key'}</button></p>
    </form>
  )
}

export function TradeSettings({ uid, admin }: { uid: string; admin: boolean }) {
  const [v, setV] = useState({ stake_usd: 1, max_open: 3, daily_max: 10, trade_untested: false })
  const [msg, setMsg] = useState('')
  useEffect(() => {
    supabase.from('user_settings').select('data').eq('user_id', uid).maybeSingle().then(({ data }) => {
      const d = (data?.data ?? {}) as Record<string, unknown>
      setV((p) => ({ stake_usd: Number(d.stake_usd ?? p.stake_usd), max_open: Number(d.max_open ?? p.max_open), daily_max: Number(d.daily_max ?? p.daily_max), trade_untested: d.trade_untested === true }))
    })
  }, [uid])
  const save = async (e: FormEvent) => {
    e.preventDefault()
    const { data } = await supabase.from('user_settings').select('data').eq('user_id', uid).maybeSingle()
    const merged = { ...((data?.data ?? {}) as object), ...v, trade_untested: admin && v.trade_untested }
    const { error } = await supabase.from('user_settings').upsert({ user_id: uid, data: merged }, { onConflict: 'user_id' })
    setMsg(error ? error.message : 'Saved. The next signal uses these numbers.')
  }
  const num = (k: 'stake_usd' | 'max_open' | 'daily_max', label: string, min: number, max: number, step: number) => (
    <label className="f">{label}<input type="number" min={min} max={max} step={step} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} required /></label>
  )
  return (
    <form className="card" onSubmit={save}>
      <h3>Trading settings</h3>
      <div className="form">{num('stake_usd', 'Stake per trade (USD, 1 to 10)', 1, 10, 1)}{num('max_open', 'Most trades open at once', 1, 10, 1)}{num('daily_max', 'Most trades per day', 1, 50, 1)}</div>
      {admin && <div className="sw"><span>Also trade untested signals<div className="mu">Your own demo account only</div></span><input type="checkbox" checked={v.trade_untested} onChange={(e) => setV({ ...v, trade_untested: e.target.checked })} /></div>}
      <p className="mu">Each trade's stop loss is set so it can lose at most half of the stake.</p>
      <p className="row"><span className={msg.startsWith('Saved') ? 'mu' : 'err'}>{msg}</span><button className="btn p" type="submit">Save</button></p>
    </form>
  )
}

export function ExecList({ uid }: { uid: string }) {
  const [rows, setRows] = useState<Exec[]>([])
  useEffect(() => {
    const load = () => { supabase.from('executions').select('id,status,message,stake,stop_loss,take_profit,created_at,signals(symbol,side,timeframe)').eq('user_id', uid).order('created_at', { ascending: false }).limit(10).then(({ data }) => data && setRows(data as unknown as Exec[])) }
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [uid])
  return (
    <div className="card"><h3>Trades sent</h3>
      {rows.length === 0 && <p className="mu">Nothing yet. A trade appears here each time the bot acts on a signal.</p>}
      {rows.map((r) => (
        <div className="sig" key={r.id}>
          <span className={`badge ${r.status === 'bought' ? 'win' : r.status === 'failed' ? 'loss' : 'open'}`}>{r.status === 'bought' ? 'Placed' : r.status === 'failed' ? 'Failed' : 'Skipped'}</span>
          <b>{r.signals ? `${r.signals.symbol} ${r.signals.side}${r.signals.timeframe ? ` · ${r.signals.timeframe}` : ''}` : 'Signal'}</b><span className="mu">{ago(r.created_at)}</span>
          {r.message && <div className="mu" style={{ gridColumn: '1 / -1' }}>{r.message}{r.status === 'bought' && r.stake != null ? ` Stake $${r.stake}, stop loss $${r.stop_loss}, take profit $${r.take_profit}.` : ''}</div>}
        </div>
      ))}
    </div>
  )
}

export default function Bot({ uid, admin = false, botAccess, goPlan }: { uid: string; admin?: boolean; botAccess: boolean; goPlan: () => void }) {
  const [st, setSt] = useState<BotState | null>(null)
  const [acct, setAcct] = useState<BotAccount | null>(null)
  const [pos, setPos] = useState<BotPos[]>([])
  const [cfg, setCfg] = useState<Cfg>(DEFAULTS)
  const [linked, setLinked] = useState<BrokerLink | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  const load = useCallback(async () => {
    const [s, a, p] = await Promise.all([
      supabase.from('bot_state').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('bot_account').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('bot_positions').select('*').eq('user_id', uid).order('opened_at', { ascending: false }).limit(20),
    ])
    if (s.data) setSt(s.data as BotState)
    if (a.data) setAcct(a.data as BotAccount)
    if (p.data) setPos(p.data as BotPos[])
  }, [uid])
  useEffect(() => {
    if (!botAccess) return
    supabase.from('bot_state').upsert({ user_id: uid }, { onConflict: 'user_id', ignoreDuplicates: true }).then(() => load())
    Promise.all([supabase.from('settings').select('data').eq('id', 1).maybeSingle(), supabase.from('user_settings').select('data').eq('user_id', uid).maybeSingle()])
      .then(([g, u]) => setCfg({ ...DEFAULTS, ...(g.data?.data as Cfg | undefined), ...(u.data?.data as Cfg | undefined) }))
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [botAccess, uid, load])

  if (!botAccess) return <Locked go={goPlan} title="Auto-trading is on the Signals + Auto-trading plan" text="Let the bot trade your own Deriv account, with loss limits and a kill switch." cta="See plans" />

  const run = async (patch: Partial<BotState>) => {
    const { error } = await supabase.from('bot_state').update(patch).eq('user_id', uid)
    setErr(error ? error.message : '')
    load()
  }
  const kill = async () => {
    setConfirm(false); setInfo('')
    if (linked) {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/deriv-kill', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } })
      const out = (await res.json().catch(() => ({}))) as { closed?: number; note?: string }
      setInfo(out.note ?? `Bot is off. Closed ${out.closed ?? 0} open trades.`)
    }
    run({ kill_requested: true, bot_on: false })
  }
  const n = (k: string) => Number(cfg[k])
  const mt5 = !!acct?.updated_at && Date.now() - new Date(acct.updated_at).getTime() < 30000      // an MT5 bot is reporting in
  const on = !!st?.bot_on
  const floating = acct?.floating ?? 0
  return (
    <>
      <DerivLink uid={uid} onLink={setLinked} />
      <div className="card">
        <div className="row">
          <div>
            <b><span className={`dot ${on ? '' : 'off'}`} />{on ? 'Bot on' : 'Bot off'}</b>
            <div className="mu">{linked ? 'Places each approved signal on your Deriv demo account.' : 'Connect your Deriv account above first.'}</div>
          </div>
          <button className={`btn ${on ? '' : 'p'}`} disabled={!st || (!linked && !mt5)} onClick={() => run({ bot_on: !on })}>{on ? 'Turn bot off' : 'Turn bot on'}</button>
        </div>
        <p className="mu ml">Turning the bot off stops new trades. Trades already open keep their stop loss and take profit.</p>
        {st?.note && <p className="mu">{st.note}</p>}
        {err && <p className="err">{err}</p>}
        {info && <p className="mu">{info}</p>}
        <button className="btn kill" onClick={() => setConfirm(true)}>Kill switch: close all trades</button>
        {confirm && (
          <div className="card warn ml"><b>Close every open trade and turn the bot off?</b><div className="mu">This cannot be undone.</div>
            <p className="row" style={{ margin: '12px 0 0' }}><button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn sm stop" onClick={kill}>Close everything</button></p></div>
        )}
      </div>
      {linked && <TradeSettings uid={uid} admin={admin} />}
      {linked && <ExecList uid={uid} />}
      {mt5 && <>
        <div className="stats c2">
          <div className="stat"><span className="mu">Balance</span><b>${(acct?.balance ?? 0).toFixed(2)}</b></div>
          <div className="stat"><span className="mu">Equity</span><b>${(acct?.equity ?? 0).toFixed(2)}</b></div>
          <div className="stat"><span className="mu">Floating</span><b className={floating >= 0 ? 'ok' : 'neg'}>{usd(floating)}</b></div>
          <div className="stat"><span className="mu">Closed today</span><b className={(acct?.closed_today ?? 0) >= 0 ? 'ok' : 'neg'}>{usd(acct?.closed_today ?? 0)}</b></div>
        </div>
        <div className="card"><h3>MT5 risk limits</h3>
          <Bar label="Basket loss" text={`${(acct?.basket_pct ?? 0).toFixed(1)}% of ${n('basket_stop_pct')}%`} v={acct?.basket_pct ?? 0} max={n('basket_stop_pct')} />
          <Bar label="Daily loss" text={`${(acct?.daily_pct ?? 0).toFixed(1)}% of ${n('daily_loss_pct')}%`} v={acct?.daily_pct ?? 0} max={n('daily_loss_pct')} />
          <Bar label="Exposure" text={`${(acct?.lots ?? 0).toFixed(2)} of ${n('max_total_lots')} lots`} v={acct?.lots ?? 0} max={n('max_total_lots')} />
        </div>
        <div className="card"><h3>MT5 open trades</h3>
          {pos.length === 0 && <p className="mu">No open trades.</p>}
          {pos.map((p) => (
            <div className="sig" key={p.ticket}>
              <span className={`tag ${p.side === 'buy' ? 'b' : 's'}`}>{p.side === 'buy' ? 'Buy' : 'Sell'}</span>
              <b>{p.symbol}<span className="tg">{p.tag === 'runner' ? 'Runner' : 'Scalp'}</span></b>
              <b className={p.profit >= 0 ? 'ok' : 'neg'}>{usd(p.profit)}</b>
              <div className="nums"><span>Lot <b>{p.lot}</b></span><span>Entry <b>{p.entry}</b></span>{p.sl != null && <span>SL <b>{p.sl}</b></span>}{p.tp != null && <span>TP <b>{p.tp}</b></span>}</div>
            </div>
          ))}
        </div>
      </>}
    </>
  )
}
