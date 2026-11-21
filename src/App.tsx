import Ea from './Ea'
import News from './News'
import ChartTab from './ChartTab'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './supabase'
import Landing from './Landing'
import Auth from './Auth'
import Home from './Home'
import Signals from './Signals'
import Bot from './Bot'
import Profile from './Profile'
import { Brand, Icon, ThemeToggle } from './ui'
import type { IconName } from './ui'
import type { Profile as P, Sub } from './types'

type Tab = 'home' | 'chart' | 'bot' | 'pro'
// Two views share one tab. Hold the tab to switch; a dot on the tab shows it has a second view.
type Pane = 'a' | 'b'
const SECOND: Partial<Record<Tab, { a: [IconName, string]; b: [IconName, string] }>> = {
  home: { a: ['home', 'Home'], b: ['bars', 'Signals'] },
  chart: { a: ['camera', 'Chart'], b: ['news', 'News'] },
  bot: { a: ['bot', 'Bot'], b: ['bot', 'EA'] },
}

function Shell({ session }: { session: Session }) {
  const [profile, setProfile] = useState<P | null>(null)
  const [sub, setSub] = useState<Sub | null>(null)
  const [tab, setTab] = useState<Tab>('home')
  const [pane, setPane] = useState<Record<string, Pane>>({ home: 'a', chart: 'a', bot: 'a' })
  const holdTimer = useRef<number | null>(null)
  const held = useRef(false)
  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([
      supabase.from('profiles').select('id,email,role').eq('id', session.user.id).maybeSingle(),
      supabase.from('subscriptions').select('plan,expires_at').eq('user_id', session.user.id).maybeSingle(),
    ])
    setProfile((p.data as P | null) ?? { id: session.user.id, email: session.user.email ?? '', role: 'user' })
    setSub((s.data as Sub | null) ?? null)
  }, [session.user.id, session.user.email])
  const [paymentsOn, setPaymentsOn] = useState(false)   // false = free access for everyone signed in
  useEffect(() => {
    fetch('/api/system?op=payments').then((r) => r.json()).then((j) => setPaymentsOn(!!j.payments_on)).catch(() => {})
  }, [])
  useEffect(() => { refresh() }, [refresh])
  if (!profile) return null

  const admin = profile.role === 'admin'
  const active = !!sub && new Date(sub.expires_at) > new Date()
  const FREE = !paymentsOn   // payments off: everyone who signs in has access
  const access = FREE || admin || active
  const botAccess = FREE || admin || (active && sub?.plan === 'auto')
  const tabs: [Tab, IconName, string][] = [['home', 'home', 'Home'], ['chart', 'camera', 'Chart'], ['bot', 'bot', 'Bot'], ['pro', 'user', 'Profile']]
  const shown = (k: Tab): [IconName, string] => {
    const s = SECOND[k]
    if (!s) { const t = tabs.find((x) => x[0] === k)!; return [t[1], t[2]] }
    return s[pane[k] === 'b' ? 'b' : 'a']
  }
  const press = (k: Tab) => {
    held.current = false
    if (!SECOND[k]) return
    holdTimer.current = window.setTimeout(() => {
      held.current = true
      if (navigator.vibrate) navigator.vibrate(12)
      setPane((p) => ({ ...p, [k]: p[k] === 'b' ? 'a' : 'b' }))
      setTab(k)
    }, 500)
  }
  const release = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null } }
  const tap = (k: Tab) => { if (held.current) { held.current = false; return } setTab(k) }
  return (
    <>
      <div className="app">
        <div className="bar"><Brand /><div className="row" style={{ gap: 8 }}><ThemeToggle /><button className="btn sm" onClick={() => supabase.auth.signOut()}><Icon n="out" />Sign out</button></div></div>
        {tab === 'home' && (pane.home === 'b' ? <Signals access={access} goPlan={() => setTab('pro')} /> : <Home uid={profile.id} admin={admin} access={access} goPlan={() => setTab('pro')} />)}
        {tab === 'chart' && (pane.chart === 'b' ? <div className="page"><News /></div> : <ChartTab uid={profile.id} />)}
        {tab === 'bot' && (pane.bot === 'b' ? <Ea /> : <Bot uid={profile.id} admin={admin} botAccess={botAccess} goPlan={() => setTab('pro')} />)}
        {tab === 'pro' && <Profile profile={profile} sub={sub} botAccess={botAccess} refresh={refresh} paymentsOn={paymentsOn} setPaymentsOn={setPaymentsOn} />}
        <footer><a className="site-tag" href="https://44thstudio.my.id" target="_blank" rel="noopener noreferrer">Built by 44th_being · 44TH-STUDIO INC</a></footer>
      </div>
      <nav className="tabs">{tabs.map(([k]) => { const [ic, l] = shown(k); return (<button key={k} className={tab === k ? 'on' : ''} onPointerDown={() => press(k)} onPointerUp={release} onPointerLeave={release} onPointerCancel={release} onContextMenu={(e) => e.preventDefault()} onClick={() => tap(k)}>{SECOND[k] && <span className="tab-dot" />}<Icon n={ic} />{l}</button>) })}</nav>
    </>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<'landing' | 'in' | 'up'>('landing')
  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) setView('landing') })
    return () => data.subscription.unsubscribe()
  }, [])
  if (configured && !ready) return null
  if (session) return <Shell session={session} />
  return view === 'landing' ? <Landing onAuth={setView} /> : <Auth mode={view} back={() => setView('landing')} />
}
