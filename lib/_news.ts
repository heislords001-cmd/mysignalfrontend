// Economic calendar, free. Reads a public weekly calendar feed (no key needed) and keeps the events that matter for our pairs.
// The feed URL can be changed in Vercel with NEWS_FEED_URL, so a different free feed can be swapped in without a code change.

export type NewsEvent = { title: string; currency: string; impact: 'High' | 'Medium'; time: string; forecast: string | null; previous: string | null }

export const NEWS_FEED_DEFAULT = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
const KEEP_IMPACT = new Set(['High', 'Medium'])

// Turns raw feed rows into clean events: high and medium impact only, sorted by time, starting from one hour ago.
export function normalizeNews(rows: unknown, nowMs = Date.now()): NewsEvent[] {
  if (!Array.isArray(rows)) return []
  const out: NewsEvent[] = []
  for (const r of rows as Record<string, unknown>[]) {
    const impact = String(r.impact ?? '')
    if (!KEEP_IMPACT.has(impact)) continue
    const t = Date.parse(String(r.date ?? ''))
    if (!Number.isFinite(t) || t < nowMs - 60 * 60 * 1000) continue
    out.push({
      title: String(r.title ?? '').slice(0, 120),
      currency: String(r.country ?? '').slice(0, 5),
      impact: impact as 'High' | 'Medium',
      time: new Date(t).toISOString(),
      forecast: r.forecast ? String(r.forecast) : null,
      previous: r.previous ? String(r.previous) : null,
    })
  }
  return out.sort((a, b) => a.time.localeCompare(b.time)).slice(0, 12)
}

let cache: { at: number; events: NewsEvent[] } | null = null
const TTL = 6 * 60 * 60 * 1000

// Fetches at most once every six hours for everyone, so the free feed is not hammered.
export async function loadNews(): Promise<{ ok: boolean; events: NewsEvent[]; note?: string }> {
  if (cache && Date.now() - cache.at < TTL) return { ok: true, events: cache.events }
  const url = (process.env.NEWS_FEED_URL ?? '').trim() || NEWS_FEED_DEFAULT
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
    if (!r.ok) return { ok: false, events: cache?.events ?? [], note: `The news feed answered ${r.status}.` }
    const events = normalizeNews(await r.json())
    cache = { at: Date.now(), events }
    return { ok: true, events }
  } catch {
    return { ok: false, events: cache?.events ?? [], note: 'The news feed could not be reached right now.' }
  }
}
