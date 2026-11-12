// Exness operations: link and the signal webhook.
import link from '../lib/handlers/exness-link.js'
import execute from '../lib/handlers/exness-execute.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: any; query?: Record<string, string | string[] | undefined>; url?: string }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

export default async function handler(req: Req, res: Res) {
  const q = req.query?.op
  const op = (Array.isArray(q) ? q[0] : q) ?? new URL(req.url ?? '/', 'http://x').searchParams.get('op') ?? ''
  if (op === 'link') return link(req as any, res as any)
  if (op === 'execute') return execute(req as any, res as any)
  return res.status(404).json({ error: 'Unknown operation.' })
}
