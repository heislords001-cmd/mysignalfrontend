// Receives a scalp plan from the backend (the GitHub run) and places the orders for eligible members.
// The request must carry the shared webhook secret. Every plan is checked before anything is placed.
import { executeScalpOrder, type ScalpOrder } from '../_execute.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const secret = (process.env.WEBHOOK_SECRET ?? '').trim()
  if (!secret || (req.headers.authorization ?? '') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Not allowed.' })
  const body = (req.body ?? {}) as Partial<ScalpOrder>
  try {
    const t = await executeScalpOrder(body as ScalpOrder)
    return res.status(200).json({ ok: !t.note, ...t })
  } catch (e) {
    return res.status(500).json({ error: `The server hit an error: ${(e as Error).message}` })
  }
}
