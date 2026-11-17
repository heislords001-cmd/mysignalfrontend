import { useEffect, useState } from 'react'
import { supabase } from './supabase'

type Ev = { title: string; currency: string; impact: 'High' | 'Medium'; time: string; forecast: string | null; previous: string | null }

// Shows the next high and medium impact events. Times are shown in Lagos time.
export default function News() {
  const [events, setEvents] = useState<Ev[] | null>(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/news', { headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } })
      const j = (await res.json().catch(() => ({}))) as { events?: Ev[]; note?: string | null }
      setEvents(j.events ?? []); setNote(j.note ?? '')
    }
    load()
    const t = setInterval(load, 30 * 60 * 1000)
    return () => clearInterval(t)
  }, [])
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="card">
      <div className="row"><h2 style={{ margin: 0 }}>Upcoming news</h2><span className="mu" style={{ fontSize: 11 }}>Lagos time</span></div>
      {events === null && <p className="mu">Loading...</p>}
      {events && events.length === 0 && <p className="mu">{note || 'No high or medium impact events in the feed right now.'}</p>}
      {events && events.map((e, i) => (
        <div key={i} className="news-row">
          <span className={`news-dot ${e.impact === 'High' ? 'hi' : 'med'}`} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="news-title">{e.currency} · {e.title}</div>
            <div className="mu" style={{ fontSize: 11 }}>{fmt(e.time)}{e.forecast ? ` · forecast ${e.forecast}` : ''}{e.previous ? ` · previous ${e.previous}` : ''}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
