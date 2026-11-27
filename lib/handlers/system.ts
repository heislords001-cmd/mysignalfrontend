// One function for the small system endpoints: /api/ping, /api/health and /api/signals (rewritten in vercel.json).
import { default as ping } from './ping.js'
import { default as health } from './health.js'
import { default as signals } from './signals.js'
import { default as signalsKey } from './signals-key.js'
import { reportMt5Trade } from './mt5-trade.js'
import { mt5Account } from './mt5-account.js'
import { membersStats } from './members.js'
import { eaConfig } from './ea-config.js'
import { paymentsSwitch } from './payments.js'

interface Req { method?: string; headers: Record<string, string | undefined>; query?: Record<string, string | string[] | undefined>; url?: string; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 30 }

export default async function handler(req: Req, res: Res) {
  const q = req.query?.op
  const path = new URL(req.url ?? '/', 'http://x').pathname
  // operation from ?op=, or from the path (/api/signals-key) if the rewrite did not pass it on
  const fromPath = path.endsWith('/signals-key') ? 'signals-key' : path.endsWith('/signals') ? 'signals' : path.endsWith('/health') ? 'health' : path.endsWith('/ping') ? 'ping' : path.endsWith('/mt5-trade') ? 'mt5-trade' : path.endsWith('/ea-config') ? 'ea-config' : path.endsWith('/payments') ? 'payments' : ''
  const op = (Array.isArray(q) ? q[0] : q) ?? new URL(req.url ?? '/', 'http://x').searchParams.get('op') ?? fromPath
  if (op === 'ping') return ping(req as any, res as any)
  if (op === 'health') return health(req as any, res as any)
  if (op === 'signals') return signals(req as any, res as any)
  if (op === 'signals-key') return signalsKey(req as any, res as any)
  if (op === 'mt5-trade') return reportMt5Trade(req as any, res as any)
  if (op === 'mt5-account') return mt5Account(req as any, res as any)
  if (op === 'members') return membersStats(req as any, res as any)
  if (op === 'ea-config') return eaConfig(req as any, res as any)
  if (op === 'payments') return paymentsSwitch(req as any, res as any)
  return res.status(404).json({ error: 'Unknown operation.' })
}
