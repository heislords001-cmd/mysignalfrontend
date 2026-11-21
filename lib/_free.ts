// The payment switch, stored in the database (settings row 1: payments_on). Payments off = free access for everyone signed in.
// If the switch cannot be read, access stays gated (never accidentally free).
let cache: { v: boolean; at: number } | null = null

export async function freeAccess(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 20000) return cache.v
  try {
    const sb = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
    const key = process.env.SUPABASE_SERVICE_KEY ?? ''
    const rows = (await (await fetch(`${sb}/rest/v1/settings?id=eq.1&select=data`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })).json()) as { data?: Record<string, unknown> }[]
    const paymentsOn = rows[0]?.data?.payments_on === true
    cache = { v: !paymentsOn, at: Date.now() }
    return !paymentsOn
  } catch {
    return false
  }
}

export function clearFreeCache(): void { cache = null }
