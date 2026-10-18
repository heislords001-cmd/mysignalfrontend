import { createClient } from '@supabase/supabase-js'

// forgive stray spaces and quote marks around pasted values
const clean = (v: unknown) => String(v ?? '').trim().replace(/^["']+|["']+$/g, '').trim()
const url = clean(import.meta.env.VITE_SUPABASE_URL)
const key = clean(import.meta.env.VITE_SUPABASE_ANON_KEY)

const jwtRole = (t: string): string | null => {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

export type Check = { found: boolean; ok: boolean; message: string }
const MISSING: Check = { found: false, ok: false, message: 'missing' }
const OK: Check = { found: true, ok: true, message: 'found' }
const bad = (message: string): Check => ({ found: true, ok: false, message })
const looksLikeKey = (v: string) => v.startsWith('eyJ') || v.startsWith('sb_')

export const urlCheck: Check = !url ? MISSING
  : /^https?:\/\/\S+$/.test(url) ? OK
  : looksLikeKey(url) ? bad('This looks like the KEY, not the URL. The two values may be swapped.')
  : bad(`It must start with https:// (yours starts with "${url.slice(0, 10)}").`)

export const keyCheck: Check = !key ? MISSING
  : key.startsWith('sb_secret_') || jwtRole(key) === 'service_role' ? bad('This is the SECRET key. Never put it here. Use the "anon public" key instead.')
  : /^https?:\/\//.test(key) ? bad('This looks like the URL, not the key. The two values may be swapped.')
  : key.length < 20 ? bad('This is too short to be the anon key.')
  : OK

// false until both settings are valid (and the site has been redeployed)
export const configured = urlCheck.ok && keyCheck.ok

export const supabase = createClient(configured ? url : 'https://not-configured.invalid', configured ? key : 'not-configured')
