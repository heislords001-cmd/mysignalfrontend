// Per-member signal switches on one shared scanner.
//   receive_on:  this member's signals switch on. If the scanner is off, this press starts it for everyone.
//   receive_off: this member's switch goes off. The scanner keeps running for others; it stops only when nobody is receiving.
// Anyone with an active plan (or the admin) may use these. Start and Stop are kept as aliases for the same two actions.
import { dbHeaders, env, userFromJwt } from '../_auth.js'

interface Req { method?: string; headers: Record<string, string | undefined>; body?: { action?: string } }
interface Res { status(c: number): Res; json(b: unknown): void }
export const config = { maxDuration: 30 }

const WORKFLOW = 'scanner.yml'
const SCALP_WORKFLOW = 'scalp.yml'
const GH = 'https://api.github.com'
const SCANNER_REPO_DEFAULT = 'heislords001-cmd/my-signalbackend'

function ghHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'fx-desk' }
}

async function activeRunIds(repo: string, token: string, workflow: string = WORKFLOW): Promise<number[]> {
  const ids: number[] = []
  for (const status of ['in_progress', 'queued']) {
    const r = await fetch(`${GH}/repos/${repo}/actions/workflows/${workflow}/runs?status=${status}&per_page=20`, { headers: ghHeaders(token) })
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
    const sub = (await (await fetch(`${sb}/rest/v1/subscriptions?user_id=eq.${user.id}&select=plan,expires_at`, { headers: h })).json()) as { plan: string; expires_at: string }[]
    const allowed = prof[0]?.role === 'admin' || (sub[0] && new Date(sub[0].expires_at).getTime() > Date.now())
    if (!allowed) return res.status(403).json({ error: 'Signals need an active plan.' })

    const token = process.env.GITHUB_SCANNER_TOKEN ?? ''
    const repo = (process.env.SCANNER_REPO || SCANNER_REPO_DEFAULT).trim()
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return res.status(500).json({ error: `SCANNER_REPO in Vercel is "${repo}", which is not owner/repo. The scanner was NOT started.` })

    const setRunning = (on: boolean) => fetch(`${sb}/rest/v1/scanner_state?id=eq.1`, { method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify({ running: on }) })
    // one member's switch: merged into their settings so their other settings are kept
    const setMine = async (on: boolean) => {
      const cur = (await (await fetch(`${sb}/rest/v1/user_settings?user_id=eq.${user.id}&select=data`, { headers: h })).json()) as { data: Record<string, unknown> }[]
      const data = { ...(cur[0]?.data ?? {}), signals_on: on }
      await fetch(`${sb}/rest/v1/user_settings?on_conflict=user_id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: user.id, data }) })
    }
    const scalpMembers = async () => {
      const r = (await (await fetch(`${sb}/rest/v1/user_settings?data->>scalp_enabled=eq.true&select=user_id`, { headers: h })).json()) as unknown[]
      return Array.isArray(r) ? r.length : 0
    }
    const receivers = async () => {
      const r = (await (await fetch(`${sb}/rest/v1/user_settings?data->>signals_on=eq.true&select=user_id`, { headers: h })).json()) as unknown[]
      return Array.isArray(r) ? r.length : 0
    }
    const stopEngine = async () => {
      await setRunning(false)
      if (!token) return 0
      try {
        const ids = await activeRunIds(repo, token)
        for (const id of ids) await fetch(`${GH}/repos/${repo}/actions/runs/${id}/cancel`, { method: 'POST', headers: ghHeaders(token) })
        return ids.length
      } catch { return 0 }
    }

    const action = req.body?.action === 'start' ? 'receive_on' : req.body?.action === 'stop' ? 'receive_off' : req.body?.action

    if (action === 'receive_off') {
      await setMine(false)
      if ((await receivers()) > 0) {
        return res.status(200).json({ ok: true, receiving: false, running: true, note: 'Your signals are off. The scanner keeps running for the others who are receiving.' })
      }
      const cancelled = await stopEngine()
      return res.status(200).json({ ok: true, receiving: false, running: false, cancelled, note: 'Nobody is receiving signals, so the scanner stopped.' })
    }

    if (action === 'receive_on') {
      await setMine(true)
      if (!token) return res.status(200).json({ ok: true, receiving: true, running: false, note: 'Your signals are on, but GITHUB_SCANNER_TOKEN is not set in Vercel, so the scanner was not started.' })
      // only one press can flip the engine from off to on
      const claim = await fetch(`${sb}/rest/v1/scanner_state?id=eq.1&running=eq.false`, { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify({ running: true }) })
      const claimRows = await claim.json().catch(() => null)
      const won = Array.isArray(claimRows) && claimRows.length > 0
      let active: number[]
      try { active = await activeRunIds(repo, token) } catch (e) {
        if (won) await setRunning(false)
        await setMine(false)
        return res.status(502).json({ error: `GitHub did not answer (${(e as Error).message}). Your signals were NOT switched on.` })
      }
      if (active.length) return res.status(200).json({ ok: true, receiving: true, running: true, started: false, note: 'Your signals are on. Connected to the scanner that is already running.' })
      const d = await fetch(`${GH}/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
        method: 'POST', headers: { ...ghHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }),
      })
      if (!d.ok) {
        await setRunning(false)
        await setMine(false)
        const txt = (await d.text().catch(() => '')).slice(0, 160)
        return res.status(502).json({ error: `GitHub refused to start the scanner (${d.status}). Check the token has Actions read and write on ${repo}. ${txt}` })
      }
      return res.status(200).json({ ok: true, receiving: true, running: true, started: true, note: 'Your signals are on. The scanner is starting on GitHub for everyone; the first check appears within a minute or two.' })
    }

    if (action === 'scalp_start') {
      // Start bot: one scalp run on GitHub for everyone who has scalp on. A second press does not start another.
      if (!token) return res.status(500).json({ error: 'GITHUB_SCANNER_TOKEN is not set in Vercel. The scalp run was NOT started.' })
      let active: number[]
      try { active = await activeRunIds(repo, token, SCALP_WORKFLOW) } catch (e) {
        return res.status(502).json({ error: `GitHub did not answer (${(e as Error).message}). The scalp run was NOT started.` })
      }
      if (active.length) return res.status(200).json({ ok: true, started: false, connected: true, note: 'Scalping is already running on GitHub. It picks up your settings.' })
      const d = await fetch(`${GH}/repos/${repo}/actions/workflows/${SCALP_WORKFLOW}/dispatches`, {
        method: 'POST', headers: { ...ghHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }),
      })
      if (!d.ok) return res.status(502).json({ error: `GitHub refused to start scalping (${d.status}). Check the token has Actions read and write on ${repo}.` })
      return res.status(200).json({ ok: true, started: true, note: 'Scalping is starting on GitHub. The first check appears within a minute or two.' })
    }

    if (action === 'scalp_stop') {
      // Stop bot: the scalp run only stops when nobody has scalp on. Otherwise it keeps going for the others.
      if ((await scalpMembers()) > 0) return res.status(200).json({ ok: true, note: 'Your scalping is off. Scalping keeps running for the other members who have it on.' })
      if (!token) return res.status(200).json({ ok: true, note: 'Your scalping is off.' })
      let cancelled = 0
      try {
        const ids = await activeRunIds(repo, token, SCALP_WORKFLOW)
        for (const id of ids) { await fetch(`${GH}/repos/${repo}/actions/runs/${id}/cancel`, { method: 'POST', headers: ghHeaders(token) }); cancelled++ }
      } catch { /* the run stops by itself when nobody has scalp on */ }
      return res.status(200).json({ ok: true, cancelled, note: 'Scalping stopped. Nobody has it on.' })
    }

    return res.status(400).json({ error: 'action must be receive_on, receive_off, scalp_start or scalp_stop.' })
  } catch (e) {
    return res.status(500).json({ error: `The server hit an error: ${(e as Error).message}` })
  }
}
