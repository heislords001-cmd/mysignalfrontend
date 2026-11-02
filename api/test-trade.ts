// Vercel function behind the "Send a test trade" button. Places ONE small trade on the caller's own Deriv demo account,
// using exactly the same rules as a real signal, and reports what happened in plain words.
import { hasBotAccess, userFromJwt } from './_auth.js'
import { executeTest } from './_execute.js'

interface Req { method?: string; headers: Record<string, string | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 60 }

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  try {
    const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', ''))
    if (!user) return res.status(401).json({ error: 'Please sign in again.' })
    if (!(await hasBotAccess(user.id))) return res.status(403).json({ error: 'Auto-trading needs the Signals + Auto-trading plan.' })
    return res.status(200).json({ ok: true, ...(await executeTest(user.id)) })
  } catch (e) {
    return res.status(500).json({ error: `The server hit an error: ${(e as Error).message}` })
  }
}
