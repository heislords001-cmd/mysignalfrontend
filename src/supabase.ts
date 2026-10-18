import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

// false until both settings are added in Vercel (and the site is redeployed)
export const configured = /^https?:\/\//.test(url) && key.length > 20

export const supabase = createClient(configured ? url : 'https://not-configured.invalid', configured ? key : 'not-configured')
