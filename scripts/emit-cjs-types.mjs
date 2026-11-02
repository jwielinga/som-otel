import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const typesDir = fileURLToPath(new URL('../dist/types/', import.meta.url))

// CommonJS consumers need `.d.cts` declarations whose relative imports resolve to `.d.cts` too.
for (const name of readdirSync(typesDir, { recursive: true })) {
  if (!name.endsWith('.d.ts')) continue
  const source = readFileSync(join(typesDir, name), 'utf8')
  const rewritten = source.replace(
    /(['"])(\.{1,2}\/[^'"]+?)\.js\1/g,
    '$1$2.cjs$1',
  )
  writeFileSync(join(typesDir, name.replace(/\.d\.ts$/, '.d.cts')), rewritten)
}
