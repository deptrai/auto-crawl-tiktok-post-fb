import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildSync } from 'esbuild'
import { test, expect } from '@playwright/test'

const execFileAsync = promisify(execFile)

interface AutomationJobSmokeResult {
  ok: boolean
  checks?: string[]
  error?: string
}

function buildFixture(): { dir: string; entry: string; resultPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-automation-job-fixture-'))
  const entry = join(dir, 'automation-job-electron-entry.cjs')
  const resultPath = join(dir, 'result.json')
  buildSync({
    entryPoints: [join(process.cwd(), 'tests/fixtures/automation-job-electron-entry.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['better-sqlite3-multiple-ciphers', 'electron'],
    logLevel: 'silent'
  })
  const bundled = readFileSync(entry, 'utf8').replace(
    /require\("better-sqlite3-multiple-ciphers"\)/g,
    `require(${JSON.stringify(join(process.cwd(), 'node_modules/better-sqlite3-multiple-ciphers'))})`
  )
  writeFileSync(entry, bundled, 'utf8')
  return { dir, entry, resultPath }
}

test('[P0] automation job repository persists and resumes state in real SQLCipher', async () => {
  const fixture = buildFixture()
  try {
    const electronBin = join(process.cwd(), 'node_modules/.bin/electron')
    await execFileAsync(electronBin, [fixture.entry], {
      env: {
        ...process.env,
        AUTOMATION_JOB_SMOKE_RESULT_PATH: fixture.resultPath
      },
      timeout: 30_000
    })
    const result = JSON.parse(readFileSync(fixture.resultPath, 'utf8')) as AutomationJobSmokeResult

    expect(result).toEqual({
      ok: true,
      checks: ['persist-resume', 'terminal-excluded', 'foreign-key-enforced']
    })
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})
