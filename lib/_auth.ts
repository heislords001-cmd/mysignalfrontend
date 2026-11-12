// Shared by the server functions: who is calling, and may they use auto-trading.
export const env = () => ({ sb: process.env.SUPABASE_URL!, key: process.env.SUPABASE_SERVICE_KEY! })
export const dbHeaders = () => ({ apikey: env().key, Authorization: `Bearer ${env().key}`, 'Content-Type': 'application/json' })

export async function userFromJwt(jwt: string): Promise<{ id: string } | null> {
  if (!jwt) return null
  const { sb, key } = env()
  const u = await fetch(`${sb}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } })
  return u.ok ? ((await u.json()) as { id: string }) : null
}

export async function hasBotAccess(userId: string): Promise<boolean> {
  const { sb } = env(), h = dbHeaders()
  const prof = (await (await fetch(`${sb}/rest/v1/profiles?id=eq.${userId}&select=role`, { headers: h })).json()) as { role: string }[]
  const sub = (await (await fetch(`${sb}/rest/v1/subscriptions?user_id=eq.${userId}&select=plan,expires_at`, { headers: h })).json()) as { plan: string; expires_at: string }[]
  return prof[0]?.role === 'admin' || (sub[0]?.plan === 'auto' && new Date(sub[0].expires_at).getTime() > Date.now())
}
