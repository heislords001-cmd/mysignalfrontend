// Loads every server function the way Vercel does (plain ES modules, no bundling). A function that cannot load would answer
// every request with a 500, so this fails the build instead and names the file.
import { build } from 'esbuild'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const files = readdirSync('api').filter((f) => f.endsWith('.ts')).map((f) => join('api', f))
const out = mkdtempSync(join(tmpdir(), 'api-'))
writeFileSync(join(out, 'package.json'), '{"type":"module"}')
await build({ entryPoints: files, outdir: out, format: 'esm', platform: 'node', logLevel: 'error' })
let bad = 0
for (const f of readdirSync(out).filter((x) => x.endsWith('.js'))) {
  try { await import(pathToFileURL(join(out, f)).href) } catch (e) { bad++; console.error(`api/${f.replace(/\.js$/, '.ts')} cannot load: ${String(e.message).split('\n')[0]}`) }
}
if (bad) { console.error(`${bad} server function(s) would crash on Vercel.`); process.exit(1) }
console.log(`all ${files.length} server functions load`)
