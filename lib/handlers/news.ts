// Upcoming high and medium impact economic events. Signed-in members only.
import { userFromJwt } from '../_auth.js'
import { loadNews } from '../_news.js'

interface Req { method?: string; headers: Record<string, string | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 15 }

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' })
  const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', ''))
  if (!user) return res.status(401).json({ error: 'Please sign in again.' })
  const r = await loadNews()
  return res.status(200).json({ ok: r.ok, events: r.events, note: r.note ?? null, source: 'Public economic calendar (free)' })
}
