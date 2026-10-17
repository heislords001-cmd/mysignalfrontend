import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Locked, ago, usd } from './ui'
import { DEFAULTS } from './types'
import type { BotAccount, BotPos, BotState, Cfg } from './types'

const Bar = ({ label, text, v, max }: { label: string; text: string; v: number; max: number }) => {
  const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0
  return <><div className="row"><span>{label}</span><span className="mu">{text}</span></div><div className={`pg ${pct >= 80 ? 'hot' : ''}`}><span style={{ width: `${pct}%` }} /></div></>
}

export default function Bot({ uid, botAccess, goPlan }: { uid: string; botAccess: boolean; goPlan: () => void }) {
  const [st, setSt] = useState<BotState | null>(null)
  const [acct, setAcct] = useState<BotAccount | null>(null)
  const [pos, setPos] = useState<BotPos[]>([])
  const [cfg, setCfg] = useState<Cfg>(DEFAULTS)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState('')

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

  if (!botAccess) return <Locked go={goPlan} title="Auto-trading is on the Signals + Auto-trading plan" text="Run your own bot on your own MT5 account, with loss limits and a kill switch." cta="See plans" />

  const run = async (patch: Partial<BotState>) => {
    const { error } = await supabase.from('bot_state').update(patch).eq('user_id', uid)
    setErr(error ? error.message : '')
    load()
  }
  const n = (k: string) => Number(cfg[k])
  const online = !!acct?.updated_at && Date.now() - new Date(acct.updated_at).getTime() < 30000
  const on = !!st?.bot_on
  const floating = acct?.floating ?? 0
  return (
    <>
      <div className="card">
        <div className="row">
          <div>
            <b><span className={`dot ${online ? (on ? '' : 'off') : 'bad'}`} />{online ? (on ? 'Bot on' : 'Bot off') : 'Your bot is offline'}</b>
            <div className="mu">{online ? `Updated ${ago(acct?.updated_at ?? null)}` : 'Start bot.py on the PC that runs your MT5.'}</div>
          </div>
          <button className={`btn ${on ? '' : 'p'}`} disabled={!st} onClick={() => run({ bot_on: !on })}>{on ? 'Turn bot off' : 'Turn bot on'}</button>
        </div>
        <p className="mu ml">Turning the bot off stops new trades. Open trades stay open until they hit take-profit or stop loss.</p>
        {st?.note && <p className="mu">{st.note}</p>}
        {err && <p className="err">{err}</p>}
        <button className="btn kill" onClick={() => setConfirm(true)}>Kill switch: close all trades</button>
        {confirm && (
          <div className="card warn ml"><b>Close every open trade and turn the bot off?</b><div className="mu">This cannot be undone.</div>
            <p className="row" style={{ margin: '12px 0 0' }}><button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn sm stop" onClick={() => { setConfirm(false); run({ kill_requested: true, bot_on: false }) }}>Close everything</button></p></div>
        )}
      </div>
      {!online && <div className="card"><h3>Connect your account</h3>
        <ol className="mu"><li>Download the bot from your Profile, under Bot access</li><li>Log in to your MT5 (start with a demo account)</li><li>Fill in the .env file, then run python bot.py</li></ol></div>}
      <div className="stats c2">
        <div className="stat"><span className="mu">Balance</span><b>${(acct?.balance ?? 0).toFixed(2)}</b></div>
        <div className="stat"><span className="mu">Equity</span><b>${(acct?.equity ?? 0).toFixed(2)}</b></div>
        <div className="stat"><span className="mu">Floating</span><b className={floating >= 0 ? 'ok' : 'neg'}>{usd(floating)}</b></div>
        <div className="stat"><span className="mu">Closed today</span><b className={(acct?.closed_today ?? 0) >= 0 ? 'ok' : 'neg'}>{usd(acct?.closed_today ?? 0)}</b></div>
      </div>
      <div className="g3">
        <div className="card"><h3>Scalp book</h3><div className="price" style={{ fontSize: 24 }}>{acct?.scalps ?? 0} / {n('scalp_target')}</div><div className="mu">open per pair</div></div>
        <div className="card"><h3>Runner book</h3><div className="price" style={{ fontSize: 24 }}>{acct?.runners ?? 0} / {n('runner_max')}</div><div className="mu">open per pair</div></div>
      </div>
      <div className="card"><h3>Risk limits</h3>
        <Bar label="Basket loss" text={`${(acct?.basket_pct ?? 0).toFixed(1)}% of ${n('basket_stop_pct')}%`} v={acct?.basket_pct ?? 0} max={n('basket_stop_pct')} />
        <Bar label="Daily loss" text={`${(acct?.daily_pct ?? 0).toFixed(1)}% of ${n('daily_loss_pct')}%`} v={acct?.daily_pct ?? 0} max={n('daily_loss_pct')} />
        <Bar label="Exposure" text={`${(acct?.lots ?? 0).toFixed(2)} of ${n('max_total_lots')} lots`} v={acct?.lots ?? 0} max={n('max_total_lots')} />
      </div>
      <div className="card"><h3>Open trades</h3>
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
    </>
  )
}
