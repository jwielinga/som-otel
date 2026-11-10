// GitHub Packages only accepts scoped names matching the repo owner, so publish a staged copy as @owner/som-otel.
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const registry = 'https://npm.pkg.github.com'
const owner = process.env.GITHUB_REPOSITORY_OWNER?.toLowerCase()
const token = process.env.GITHUB_TOKEN

if (!owner || !token) {
  throw new Error('GITHUB_REPOSITORY_OWNER and GITHUB_TOKEN must be set')
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const stage = mkdtempSync(join(tmpdir(), 'som-ghp-'))

try {
  for (const file of pkg.files) {
    cpSync(file, join(stage, file), { recursive: true })
  }
  const name = `@${owner}/${pkg.name.replace(/^@[^/]+\//, '')}`
  writeFileSync(
    join(stage, 'package.json'),
    JSON.stringify(
      { ...pkg, name, publishConfig: { registry, access: 'public' } },
      null,
      2,
    ),
  )

  const userconfig = join(stage, '.npmrc.publish')
  writeFileSync(userconfig, `//npm.pkg.github.com/:_authToken=${token}\n`)

  execFileSync(
    'npm',
    ['publish', stage, '--registry', registry, '--userconfig', userconfig],
    {
      stdio: 'inherit',
    },
  )
} finally {
  rmSync(stage, { recursive: true, force: true })
}
