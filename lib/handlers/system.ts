// One function for the small system endpoints: /api/ping, /api/health and /api/signals (rewritten in vercel.json).
import { default as ping } from './ping.js'
import { default as health } from './health.js'
import { default as signals } from './signals.js'
import { default as signalsKey } from './signals-key.js'

interface Req { method?: string; headers: Record<string, string | undefined>; query?: Record<string, string | string[] | undefined>; url?: string; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 30 }

export default async function handler(req: Req, res: Res) {
  const q = req.query?.op
  const op = (Array.isArray(q) ? q[0] : q) ?? new URL(req.url ?? '/', 'http://x').searchParams.get('op') ?? ''
  if (op === 'ping') return ping(req as any, res as any)
  if (op === 'health') return health(req as any, res as any)
  if (op === 'signals') return signals(req as any, res as any)
  if (op === 'signals-key') return signalsKey(req as any, res as any)
  return res.status(404).json({ error: 'Unknown operation.' })
}
