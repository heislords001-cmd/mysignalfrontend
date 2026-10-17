import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { Brand } from './ui'

export default function Auth({ mode, back }: { mode: 'in' | 'up'; back: () => void }) {
  const [up, setUp] = useState(mode === 'up')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg('')
    if (up) {
      const { data, error } = await supabase.auth.signUp({ email, password })
      setBad(!!error)
      if (error) setMsg(error.message)
      else if (!data.session) setMsg('Account created. Check your email to confirm it, then sign in.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      setBad(!!error)
      if (error) setMsg(error.message)
    }
  }
  return (
    <form className="login" onSubmit={submit}>
      <Brand />
      <h2 style={{ margin: 0 }}>{up ? 'Create your account' : 'Welcome back'}</h2>
      <label className="f">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
      <label className="f">Password<input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={up ? 'new-password' : 'current-password'} /></label>
      {msg && <div className={bad ? 'err' : 'mu'}>{msg}</div>}
      <button className="btn p" type="submit">{up ? 'Create account' : 'Sign in'}</button>
      <div className="row"><button type="button" className="btn sm" onClick={() => setUp(!up)}>{up ? 'I have an account' : 'Create an account'}</button><button type="button" className="btn sm" onClick={back}>Back</button></div>
    </form>
  )
}
