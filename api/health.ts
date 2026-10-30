// Vercel function for the admin's "System check" button: reports which settings and database pieces are in place.
// It returns only yes/no answers and never any secret value.
import { dbHeaders, env as serverEnv, userFromJwt } from './_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }

const TABLES = ['scanner_state', 'signals', 'strategy_stats', 'broker_links', 'broker_secrets', 'executions', 'user_settings', 'bot_state']

export default async function handler(req: Req, res: Res) {
  try {
    const env: Record<string, boolean> = {}
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'TOKEN_ENCRYPTION_KEY', 'WEBHOOK_SECRET']) env[k] = !!process.env[k]
    env.TOKEN_ENCRYPTION_KEY_VALID = /^[0-9a-fA-F]{64}$/.test(process.env.TOKEN_ENCRYPTION_KEY ?? '')
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return res.status(200).json({ env, note: 'The Supabase settings are missing in Vercel, so nothing else can be checked yet.' })

    const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', ''))
    if (!user) return res.status(401).json({ error: 'Please sign in again.' })
    const { sb } = serverEnv(), h = dbHeaders()
    const prof = (await (await fetch(`${sb}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: h })).json()) as { role: string }[]
    if (prof[0]?.role !== 'admin') return res.status(403).json({ error: 'Only the admin can run the system check.' })

    const probe = async (path: string) => {
      const r = await fetch(`${sb}/rest/v1/${path}`, { headers: h })
      if (r.ok) return 'ok'
      return /does not exist|PGRST205|42P01|schema cache/i.test(await r.text().catch(() => '')) ? 'missing' : 'error'
    }
    const tables: Record<string, string> = {}
    for (const t of TABLES) tables[t] = await probe(`${t}?select=*&limit=1`)
    const migration2 = (await probe('signals?select=approved&limit=1')) === 'ok' && (await probe('scanner_state?select=approved,combos,note&limit=1')) === 'ok'
    const row = (await (await fetch(`${sb}/rest/v1/scanner_state?id=eq.1&select=*`, { headers: h })).json()) as Record<string, unknown>[]
    const s = row[0]
    return res.status(200).json({
      env, tables, migration2, websocket: typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'undefined',
      scanner: s ? { running: !!s.running, heartbeat: s.heartbeat ?? null, last_error: s.last_error ?? null, approved: s.approved ?? null, combos: s.combos ?? null, note: s.note ?? null } : null,
    })
  } catch (e) {
    return res.status(500).json({ error: `The check hit an error: ${(e as Error).message}` })
  }
}
