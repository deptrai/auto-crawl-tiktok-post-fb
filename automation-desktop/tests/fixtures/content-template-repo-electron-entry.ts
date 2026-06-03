import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { openEncryptedDatabase } from '../../src/main/db/client'
import { createContentTemplateRepository } from '../../src/main/db/repositories/content-template-repo'

type SmokeResult = { ok: true; checks: string[] } | { ok: false; error: string }

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function runSmoke(): SmokeResult {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-content-template-repo-'))
  const db = openEncryptedDatabase({
    path: join(dir, 'phase3.db'),
    key: 'content-template-test-key'
  })
  const checks: string[] = []
  try {
    const repo = createContentTemplateRepository(db)
    repo.seedDefaults('2026-06-03T00:00:00.000Z')
    assert(repo.listTemplates().length >= 1, 'default seed missing')
    checks.push('seed-default')

    db.prepare(
      'INSERT INTO content_templates(id, label, body, created_at) VALUES (?, ?, ?, ?)'
    ).run('tpl-second', 'Second', 'Nội dung thứ hai', '2026-06-03T00:00:01.000Z')
    assert(
      repo.listTemplates().some((template) => template.id === 'tpl-second'),
      'list missing inserted row'
    )
    checks.push('list')

    const selected = repo.getRandomTemplate(() => 0.99)
    assert(selected?.id === 'tpl-second', 'deterministic random did not pick expected row')
    checks.push('deterministic-random')

    const created = repo.createTemplate({
      label: 'Created',
      body: 'Nội dung mới',
      createdAt: '2026-06-03T00:00:02.000Z'
    })
    assert(created.id.length > 0, 'create did not assign id')
    assert(repo.countTemplates() === 3, 'count after create mismatch')
    checks.push('create-count')

    const updated = repo.updateTemplate({
      id: created.id,
      label: 'Updated',
      body: 'Nội dung đã sửa'
    })
    assert(updated?.label === 'Updated', 'update label mismatch')
    assert(updated.body === 'Nội dung đã sửa', 'update body mismatch')
    checks.push('update')

    assert(repo.deleteTemplate(created.id) === 1, 'delete did not affect one row')
    assert(repo.countTemplates() === 2, 'count after delete mismatch')
    checks.push('delete')

    return { ok: true, checks }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

void app.whenReady().then(() => {
  const resultPath = process.env['CONTENT_TEMPLATE_SMOKE_RESULT_PATH']
  if (!resultPath) throw new Error('CONTENT_TEMPLATE_SMOKE_RESULT_PATH is required')
  writeFileSync(resultPath, JSON.stringify(runSmoke()), 'utf8')
  app.quit()
})
