import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Icon, ago } from './ui'

type Read = {
  visible_trend?: string; candles?: string; swing_points?: string; visible_levels?: string
  possible_setup?: string; setup_condition?: string; not_visible?: string
}
type Setup = { side: string; entry: number; stop_loss: number; take_profit_1: number; take_profit_2: number; basis: string }
type Saved = { id: number; symbol: string; timeframe: string; read: Read; created_at: string }

const TREND: Record<string, string> = { up: 'ok', down: 'neg', sideways: 'mu', unclear: 'mu' }

// Any photo (iPhone HEIC, camera JPEG, screenshot PNG) becomes a small JPEG on the phone first.
async function toJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('This photo format is not supported on this device. Take a new photo or pick a screenshot.'))
      i.src = url
    })
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function ChartTab({ uid }: { uid: string }) {
  const [on, setOn] = useState<boolean | undefined>(undefined)
  const [preview, setPreview] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<any>(null)
  const [history, setHistory] = useState<Saved[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)

  const loadHistory = useCallback(() => {
    supabase.from('chart_reads').select('id,symbol,timeframe,read,created_at').eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setHistory((data ?? []) as Saved[]))
  }, [uid])

  useEffect(() => {
    supabase.from('user_settings').select('data').eq('user_id', uid).maybeSingle().then(({ data }) => {
      setOn(((data?.data ?? {}) as Record<string, unknown>).chart_read_on === true)
    })
    loadHistory()
  }, [uid, loadHistory])

  const toggle = async (v: boolean) => {
    setOn(v); setErr('')
    const { data } = await supabase.from('user_settings').select('data').eq('user_id', uid).maybeSingle()
    await supabase.from('user_settings').upsert({ user_id: uid, data: { ...((data?.data ?? {}) as object), chart_read_on: v } }, { onConflict: 'user_id' })
  }

  const pick = async (file?: File) => {
    if (!file) return
    setErr(''); setResult(null)
    try { setPreview(await toJpeg(file)) } catch (e) { setPreview(''); setErr((e as Error).message) }
  }

  const read = async () => {
    if (!preview) return
    setBusy(true); setErr(''); setResult(null)
    const { data } = await supabase.auth.getSession()
    const res = await fetch('/api/chart-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify({ image: preview }),
    })
    const j = (await res.json().catch(() => ({}))) as any
    setBusy(false)
    if (!res.ok) return setErr(j.error ?? `The chart read failed (status ${res.status}).`)
    setResult(j); loadHistory()
  }

  const remove = async (id: number) => {
    await supabase.from('chart_reads').delete().eq('id', id)
    setOpenId(null); loadHistory()
  }

  if (on === undefined) return null

  return (
    <div className="chart-tab">
      <div className="card">
        <div className="row">
          <div>
            <h2 style={{ margin: 0 }}>Chart reading</h2>
            <div className="mu">Upload a chart and get a written read of it.</div>
          </div>
          <label className="sw" style={{ margin: 0 }}><input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /></label>
        </div>
        {!on && <p className="mu">Switch on to start. It is off until you turn it on, and it never places a trade.</p>}
      </div>

      {on && (
        <>
          <div className="card drop-card">
            {!preview ? (
              <div className="drop-empty">
                <div className="drop-icon"><Icon n="camera" /></div>
                <b>Add a chart</b>
                <div className="mu">PNG, JPEG, WEBP or a phone photo. Up to 10 reads a day.</div>
                <div className="drop-actions">
                  <button className="btn brown" onClick={() => camera.current?.click()}>Take photo</button>
                  <button className="btn" onClick={() => gallery.current?.click()}>Choose from gallery</button>
                </div>
              </div>
            ) : (
              <div>
                <img className="preview" src={preview} alt="Chart to read" />
                <div className="drop-actions">
                  <button className="btn brown" disabled={busy} onClick={read}>{busy ? 'Reading the chart...' : 'Read this chart'}</button>
                  <button className="btn" disabled={busy} onClick={() => { setPreview(''); setResult(null) }}>Remove</button>
                </div>
              </div>
            )}
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
            <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
            {err && <p className="err" style={{ wordBreak: 'break-word' }}>{err}</p>}
          </div>

          {result && <ReadCard read={result.read} symbol={result.symbol} timeframe={result.timeframe} reference={result.reference} setup={result.setup} />}

          <div className="card">
            <h3>Your reads</h3>
            {history.length === 0 && <p className="mu">No reads yet.</p>}
            {history.map((h) => (
              <div key={h.id} className="hist" onClick={() => setOpenId(openId === h.id ? null : h.id)}>
                <div className="row">
                  <b>{h.symbol} · {h.timeframe}</b>
                  <span className={`chip ${TREND[h.read.visible_trend ?? ''] ?? 'mu'}`}>{h.read.visible_trend ?? 'unclear'}</span>
                  <span className="mu">{ago(h.created_at)}</span>
                </div>
                {openId === h.id && (
                  <div className="ml">
                    <ReadCard read={h.read} symbol={h.symbol} timeframe={h.timeframe} reference={null} setup={null} compact />
                    <button className="btn sm stop" onClick={(e) => { e.stopPropagation(); remove(h.id) }}>Delete this read</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ReadCard({ read, symbol, timeframe, reference, setup, compact }: { read: Read; symbol: string; timeframe: string; reference: string | null; setup: Setup | null; compact?: boolean }) {
  return (
    <div className={`card read-card ${compact ? 'compact' : ''}`}>
      <div className="row">
        <div><b>{symbol} · {timeframe}</b></div>
        <span className={`chip ${TREND[read.visible_trend ?? ''] ?? 'mu'}`}>{read.visible_trend ?? 'unclear'}</span>
      </div>
      <Block title="Last candles" text={read.candles} />
      <Block title="Swing points" text={read.swing_points} />
      <Block title="Visible levels" text={read.visible_levels} />
      <Block title="Possible setup" text={read.possible_setup && read.possible_setup !== 'none' ? `${read.possible_setup.toUpperCase()}: ${read.setup_condition ?? ''}` : 'None visible'} />
      {setup && (
        <div className="block">
          <div className="label">Possible setup from our live data</div>
          <div className="pills">
            <div className="pill entry"><span className="pl">ENTRY</span><span className="pv">{setup.entry}</span></div>
            <div className="pill sl"><span className="pl">STOP LOSS</span><span className="pv">{setup.stop_loss}</span></div>
            <div className="pill tp"><span className="pl">TAKE PROFIT 1</span><span className="pv">{setup.take_profit_1}</span></div>
            <div className="pill tp"><span className="pl">TAKE PROFIT 2</span><span className="pv">{setup.take_profit_2}</span></div>
          </div>
          <div className="mu">{setup.basis}</div>
        </div>
      )}
      <Block title="Not visible on this chart" text={read.not_visible} />
      {reference && <Block title="Our live data" text={reference} />}
      <div className="disclaimer">Describes what is on the chart. A possible setup is not a signal and has not been tested.</div>
    </div>
  )
}

function Block({ title, text }: { title: string; text?: string }) {
  if (!text) return null
  return <div className="block"><div className="label">{title}</div><div>{text}</div></div>
}
