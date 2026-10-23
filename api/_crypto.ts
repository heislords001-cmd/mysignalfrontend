// AES-256-GCM: encrypts members' API keys before they are stored. The key lives only in Vercel's server settings.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function key(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY ?? ''
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters')
  return Buffer.from(hex, 'hex')
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
}

export function decrypt(blob: string): string {
  const raw = Buffer.from(blob, 'base64')
  const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}
