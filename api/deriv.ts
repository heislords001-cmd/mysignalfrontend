// Deriv operations: link, kill switch, results, test trade.
import link from '../lib/handlers/deriv-link.js'
import kill from '../lib/handlers/deriv-kill.js'
import results from '../lib/handlers/deriv-results.js'
import test from '../lib/handlers/test-trade.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: any; query?: Record<string, string | string[] | undefined>; url?: string }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

export default async function handler(req: Req, res: Res) {
  const q = req.query?.op
  const op = (Array.isArray(q) ? q[0] : q) ?? new URL(req.url ?? '/', 'http://x').searchParams.get('op') ?? ''
  if (op === 'link') return link(req as any, res as any)
  if (op === 'kill') return kill(req as any, res as any)
  if (op === 'results') return results(req as any, res as any)
  if (op === 'test') return test(req as any, res as any)
  return res.status(404).json({ error: 'Unknown operation.' })
}
