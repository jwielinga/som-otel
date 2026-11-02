import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const root = new URL('../', import.meta.url).pathname
const require = createRequire(import.meta.url)

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

run('pnpm', ['exec', 'publint', '--strict', '--pack', 'npm'])
run('pnpm', ['exec', 'attw', '--pack', '.'])

// Each shipped format must expose the public API.
const esm = await import(new URL('../dist/som.js', import.meta.url))
const cjs = require('../dist/som.cjs')
const iife = {}
runInNewContext(
  readFileSync(new URL('../dist/som.iife.js', import.meta.url), 'utf8'),
  iife,
)

for (const [format, api] of [
  ['ESM', esm],
  ['CJS', cjs],
  ['IIFE', iife.Som],
]) {
  for (const name of ['createSom', 'createSomLogger']) {
    if (typeof api?.[name] !== 'function') {
      throw new Error(`${format} build does not export ${name}`)
    }
  }
}
console.log('ESM, CJS and IIFE builds export the public API')
