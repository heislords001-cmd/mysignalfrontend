// Checks a Deriv API token by asking Deriv who it belongs to. The token is only ever sent to Deriv itself.
export type DerivResult =
  | { ok: true; loginid: string; isVirtual: boolean; currency: string }
  | { ok: false; reason: 'invalid' | 'unreachable'; message: string }

export function derivAuthorize(token: string, appId: string, timeoutMs = 8000): Promise<DerivResult> {
  const WS = (globalThis as unknown as { WebSocket?: new (url: string) => any }).WebSocket
  return new Promise((resolve) => {
    if (!WS) return resolve({ ok: false, reason: 'unreachable', message: 'This server cannot open a WebSocket.' })
    let done = false
    let ws: any
    const finish = (r: DerivResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { ws?.close() } catch { /* already closed */ }
      resolve(r)
    }
    const timer = setTimeout(() => finish({ ok: false, reason: 'unreachable', message: 'Deriv did not answer in time.' }), timeoutMs)
    try { ws = new WS(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`) } catch { return finish({ ok: false, reason: 'unreachable', message: 'Could not reach Deriv.' }) }
    ws.onopen = () => ws.send(JSON.stringify({ authorize: token }))
    ws.onerror = () => finish({ ok: false, reason: 'unreachable', message: 'Could not reach Deriv.' })
    ws.onmessage = (ev: { data: unknown }) => {
      let m: any
      try { m = JSON.parse(String(ev.data)) } catch { return }
      if (m.msg_type !== 'authorize') return
      if (m.error) {
        return finish(m.error.code === 'InvalidToken'
          ? { ok: false, reason: 'invalid', message: 'Deriv says this token is not valid.' }
          : { ok: false, reason: 'unreachable', message: `Deriv could not check it (${m.error.code ?? 'error'}).` })
      }
      const a = m.authorize ?? {}
      finish({ ok: true, loginid: String(a.loginid ?? ''), isVirtual: !!a.is_virtual, currency: String(a.currency ?? '') })
    }
  })
}
