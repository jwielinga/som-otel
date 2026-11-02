import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const [baseDir, headDir] = process.argv.slice(2)
if (!baseDir || !headDir) {
  throw new Error('Usage: node bundle-size.mjs <base-dir> <head-dir>')
}

const files = ['som.js', 'som.cjs', 'som.iife.js']

function measure(dir, file) {
  const path = join(dir, 'dist', file)
  if (!existsSync(path)) return undefined
  const bytes = readFileSync(path)
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length }
}

const kb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`

function change(base, head) {
  if (!head) return 'removed'
  if (!base) return 'new'
  const delta = head.gzip - base.gzip
  if (delta === 0) return 'no change'
  const sign = delta > 0 ? '+' : '-'
  const percent = ((Math.abs(delta) / base.gzip) * 100).toFixed(1)
  return `${sign}${kb(Math.abs(delta))} (${sign}${percent}%)`
}

const rows = files.map((file) => {
  const base = measure(baseDir, file)
  const head = measure(headDir, file)
  return `| \`${file}\` | ${base ? kb(base.gzip) : '-'} | ${head ? kb(head.gzip) : '-'} | ${change(base, head)} | ${head ? kb(head.raw) : '-'} |`
})

console.log(`<!-- som-bundle-size -->
### Bundle size

| File | Base (gzip) | Head (gzip) | Change | Head (raw) |
| --- | --- | --- | --- | --- |
${rows.join('\n')}`)
