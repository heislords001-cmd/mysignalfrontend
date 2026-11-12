// Admin-only. Start and Stop for the scanner, from the site.
//   start: sets scanner_state.running = true, then starts the scanner workflow on GitHub.
//          If GitHub cannot start it, the flag is put back to false, so the site never claims a run that is not happening.
//   stop:  sets running = false, then cancels any scanner run still active on GitHub, so it stops at once.
// Needs two Vercel settings: GITHUB_SCANNER_TOKEN (a fine-grained token, Actions read and write, scanner repo only)
// and SCANNER_REPO (optional; defaults to heislords001-cmd/my-signalbackend).
import { dbHeaders, env, userFromJwt } from './_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { action?: string } }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 30 }

const WORKFLOW = 'scanner.yml'
// The scanner repo. SCANNER_REPO in Vercel overrides it if you ever move the scanner.
const SCANNER_REPO_DEFAULT = 'heislords001-cmd/my-signalbackend'
const GH = 'https://api.github.com'

function ghHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'fx-desk' }
}

async function activeRunIds(repo: string, token: string): Promise<number[]> {
  const ids: number[] = []
  for (const status of ['in_progress', 'queued']) {
    const r = await fetch(`${GH}/repos/${repo}/actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=20`, { headers: ghHeaders(token) })
    if (!r.ok) throw new Error(`GitHub listed runs with ${r.status}`)
    const j = await r.json() as { workflow_runs?: { id: number }[] }
    for (const run of j.workflow_runs ?? []) ids.push(run.id)
  }
  return ids
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  try {
    const user = await userFromJwt((req.headers.authorization ?? '').replace('Bearer ', ''))
    if (!user) return res.status(401).json({ error: 'Please sign in again.' })
    const { sb } = env(), h = dbHeaders()
    const prof = (await (await fetch(`${sb}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: h })).json()) as { role: string }[]
    if (prof[0]?.role !== 'admin') return res.status(403).json({ error: 'Only the admin can start or stop the scanner.' })

    const action = req.body?.action
    const token = process.env.GITHUB_SCANNER_TOKEN ?? ''
    const repo = (process.env.SCANNER_REPO || SCANNER_REPO_DEFAULT).trim()
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return res.status(500).json({ error: 'SCANNER_REPO must be owner/repo (your scanner repository). The scanner was NOT started.' })
    const setRunning = (on: boolean) => fetch(`${sb}/rest/v1/scanner_state?id=eq.1`, { method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify({ running: on }) })

    if (action === 'stop') {
      await setRunning(false)
      if (!token) return res.status(200).json({ ok: true, running: false, cancelled: 0, note: 'Scanner paused. GITHUB_SCANNER_TOKEN is not set, so a run already on GitHub will stop within 5 minutes.' })
      try {
        const ids = await activeRunIds(repo, token)
        for (const id of ids) await fetch(`${GH}/repos/${repo}/actions/runs/${id}/cancel`, { method: 'POST', headers: ghHeaders(token) })
        return res.status(200).json({ ok: true, running: false, cancelled: ids.length })
      } catch (e) {
        return res.status(200).json({ ok: true, running: false, cancelled: 0, note: `Scanner paused, but GitHub could not be asked to stop it (${(e as Error).message}). It will stop within 5 minutes.` })
      }
    }

    if (action === 'start') {
      if (!token) return res.status(500).json({ error: 'GITHUB_SCANNER_TOKEN is not set in Vercel. Add it as a Secret and redeploy. The scanner was NOT started.' })
      let active: number[]
      try { active = await activeRunIds(repo, token) } catch (e) {
        return res.status(502).json({ error: `GitHub did not answer (${(e as Error).message}). The scanner was NOT started.` })
      }
      if (active.length) {
        await setRunning(true)
        return res.status(200).json({ ok: true, running: true, started: false, note: 'The scanner is already running on GitHub.' })
      }
      await setRunning(true)
      const d = await fetch(`${GH}/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
        method: 'POST', headers: { ...ghHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }),
      })
      if (!d.ok) {
        await setRunning(false)
        const txt = (await d.text().catch(() => '')).slice(0, 160)
        return res.status(502).json({ error: `GitHub refused to start the scanner (${d.status}). Check the token has Actions read and write on ${repo}. ${txt}` })
      }
      return res.status(200).json({ ok: true, running: true, started: true, note: 'Scanner starting on GitHub. The first check appears within a minute or two.' })
    }

    return res.status(400).json({ error: 'action must be start or stop.' })
  } catch (e) {
    return res.status(500).json({ error: `The server hit an error: ${(e as Error).message}` })
  }
}
