// Checks the secret that Supabase sends with every webhook call.
import { timingSafeEqual } from 'node:crypto'

export function checkHook(headers: Record<string, string | undefined>): 'ok' | 'not_set' | 'denied' {
  const want = process.env.WEBHOOK_SECRET
  if (!want) return 'not_set'
  const got = (headers.authorization ?? '').replace('Bearer ', '')
  const a = Buffer.from(got), b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'denied'
}
