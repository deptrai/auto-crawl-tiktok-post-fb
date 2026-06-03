import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { openEncryptedDatabase } from '../../src/main/db/client'
import {
  createProfileRepository,
  type ProfileRepository
} from '../../src/main/db/repositories/profile-repo'
import { createFingerprintService, generateFingerprint } from '../../src/main/automation'

type SmokeResult = { ok: true; checks: string[] } | { ok: false; error: string }

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function insertProfile(repo: ProfileRepository, id: string): void {
  repo.insertProfileAtomic(
    {
      id,
      uid: `uid-${id}`,
      displayName: `Profile ${id}`,
      status: 'idle',
      createdAt: '2026-06-03T00:00:00.000Z'
    },
    []
  )
}

function runSmoke(): SmokeResult {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-fingerprint-service-'))
  const db = openEncryptedDatabase({ path: join(dir, 'phase3.db'), key: 'fingerprint-test-key' })
  const checks: string[] = []
  try {
    const repo = createProfileRepository(db)
    const service = createFingerprintService({ profileRepo: repo })

    const profileId = 'profile-fingerprint-1'
    insertProfile(repo, profileId)
    const first = service.ensureFingerprint(profileId)
    const storedAfterFirst = repo.getMetadata(profileId, 'fingerprint')
    const second = service.ensureFingerprint(profileId)
    const storedAfterSecond = repo.getMetadata(profileId, 'fingerprint')
    assert(
      JSON.stringify(first) === JSON.stringify(generateFingerprint(profileId)),
      'generated mismatch'
    )
    assert(JSON.stringify(second) === JSON.stringify(first), 'ensureFingerprint not idempotent')
    assert(storedAfterFirst === JSON.stringify(first), 'stored JSON mismatch after first ensure')
    assert(storedAfterSecond === storedAfterFirst, 'stored JSON changed on second ensure')
    checks.push('persist-idempotent')

    const corruptId = 'profile-fingerprint-corrupt'
    insertProfile(repo, corruptId)
    repo.setMetadata(corruptId, 'fingerprint', '{broken')
    const healed = service.ensureFingerprint(corruptId)
    assert(
      JSON.stringify(healed) === JSON.stringify(generateFingerprint(corruptId)),
      'self-heal mismatch'
    )
    assert(
      repo.getMetadata(corruptId, 'fingerprint') === JSON.stringify(healed),
      'self-heal did not persist'
    )
    checks.push('self-heal-corrupt')

    const metaId = 'profile-metadata-round-trip'
    insertProfile(repo, metaId)
    repo.setMetadata(metaId, 'fingerprint-test-key', 'value-1')
    assert(
      repo.getMetadata(metaId, 'fingerprint-test-key') === 'value-1',
      'metadata round-trip failed'
    )
    assert(
      repo.getMetadata(metaId, 'missing-key') === undefined,
      'missing metadata key should be undefined'
    )
    checks.push('metadata-round-trip')

    return { ok: true, checks }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

void app.whenReady().then(() => {
  const result = runSmoke()
  const resultPath = process.env['FINGERPRINT_SMOKE_RESULT_PATH']
  if (resultPath) writeFileSync(resultPath, JSON.stringify(result), 'utf8')
  app.quit()
})
