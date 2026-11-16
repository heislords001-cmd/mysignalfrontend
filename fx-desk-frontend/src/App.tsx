import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './supabase'
import Landing from './Landing'
import Auth from './Auth'
import Home from './Home'
import Signals from './Signals'
import Bot from './Bot'
import Profile from './Profile'
import { Brand, Icon } from './ui'
import type { IconName } from './ui'
import type { Profile as P, Sub } from './types'

type Tab = 'home' | 'sig' | 'bot' | 'pro'

function Shell({ session }: { session: Session }) {
  const [profile, setProfile] = useState<P | null>(null)
  const [sub, setSub] = useState<Sub | null>(null)
  const [tab, setTab] = useState<Tab>('home')
  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([
      supabase.from('profiles').select('id,email,role').eq('id', session.user.id).maybeSingle(),
      supabase.from('subscriptions').select('plan,expires_at').eq('user_id', session.user.id).maybeSingle(),
    ])
    setProfile((p.data as P | null) ?? { id: session.user.id, email: session.user.email ?? '', role: 'user' })
    setSub((s.data as Sub | null) ?? null)
  }, [session.user.id, session.user.email])
  useEffect(() => { refresh() }, [refresh])
  if (!profile) return null

  const admin = profile.role === 'admin'
  const active = !!sub && new Date(sub.expires_at) > new Date()
  const access = admin || active
  const botAccess = admin || (active && sub?.plan === 'auto')
  const tabs: [Tab, IconName, string][] = [['home', 'home', 'Home'], ['sig', 'bars', 'Signals'], ['bot', 'bot', 'Bot'], ['pro', 'user', 'Profile']]
  return (
    <>
      <div className="app">
        <div className="bar"><Brand /><button className="btn sm" onClick={() => supabase.auth.signOut()}><Icon n="out" />Sign out</button></div>
        {tab === 'home' && <Home admin={admin} access={access} goPlan={() => setTab('pro')} />}
        {tab === 'sig' && <Signals access={access} goPlan={() => setTab('pro')} />}
        {tab === 'bot' && <Bot uid={profile.id} botAccess={botAccess} goPlan={() => setTab('pro')} />}
        {tab === 'pro' && <Profile profile={profile} sub={sub} botAccess={botAccess} refresh={refresh} />}
      </div>
      <nav className="tabs">{tabs.map(([k, ic, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon n={ic} />{l}</button>)}</nav>
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
