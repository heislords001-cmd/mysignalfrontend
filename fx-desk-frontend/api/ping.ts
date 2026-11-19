// A tiny function with no imports. Open https://YOUR-SITE/api/ping in a browser: if you see {"ok":true,...}, the server functions work.
// It shows only yes/no answers, never a secret value.
interface Res { status(c: number): Res; json(b: unknown): void }

export default function handler(_req: unknown, res: Res) {
  const has = (k: string) => !!process.env[k]
  res.status(200).json({
    ok: true, node: process.version, websocket: typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'undefined',
    settings: { SUPABASE_URL: has('SUPABASE_URL'), SUPABASE_SERVICE_KEY: has('SUPABASE_SERVICE_KEY'), TOKEN_ENCRYPTION_KEY: has('TOKEN_ENCRYPTION_KEY'), WEBHOOK_SECRET: has('WEBHOOK_SECRET') },
  })
}
