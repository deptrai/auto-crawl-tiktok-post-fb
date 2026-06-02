import { randomUUID } from 'node:crypto'
import type { SecureStorage } from '../../adapters/secure-storage'
import { brandSecret, revealSecret, type Secret } from '../../shared/types/secret'
import type { ProfileRepository } from '../db/repositories/profile-repo'
import { MAX_LINES, parseBulkProfiles } from './parser'

export class ProfileServiceError extends Error {
  code: string
  retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'ProfileServiceError'
    this.code = code
    this.retryable = retryable
  }
}

export interface ImportedProfile {
  id: string
  uid: string
  displayName: string
  status: 'idle'
}

export interface SkippedEntry {
  line: number
  uid: string
  reason: string
}

export interface FailedEntry {
  line: number
  uid?: string
  reason: string
}

export interface ImportResult {
  total: number
  imported: number
  skipped: SkippedEntry[]
  failed: FailedEntry[]
  profiles: ImportedProfile[]
}

export interface ProfileService {
  importBulk(text: string): Promise<ImportResult>
}

export interface ProfileServiceDeps {
  storage: SecureStorage
  repo: ProfileRepository
  importDelayMs?: number
}

/** Secret key convention: profile.<id>.<field> in safeStorage. */
function secretKey(
  id: string,
  field: 'cookie' | 'twofa' | 'fb_password' | 'mail_password'
): string {
  return `profile.${id}.${field}`
}

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const { storage, repo } = deps

  return {
    async importBulk(text) {
      const {
        parsed,
        errors: parseErrors,
        lineCapExceeded,
        dataLineCount
      } = parseBulkProfiles(text)

      if (lineCapExceeded) {
        throw new ProfileServiceError(
          'LINE_CAP_EXCEEDED',
          `Quá nhiều dòng: tối đa ${MAX_LINES} dòng mỗi lần import (nhận ${dataLineCount} dòng).`,
          false
        )
      }

      if (deps.importDelayMs && deps.importDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, deps.importDelayMs))
      }

      const skipped: SkippedEntry[] = []
      const failed: FailedEntry[] = []
      const profiles: ImportedProfile[] = []

      // Track uids seen in this batch to detect in-batch duplicates
      const batchUids = new Set<string>()

      for (const p of parsed) {
        // Dedupe: in-batch duplicate
        if (batchUids.has(p.uid)) {
          skipped.push({
            line: p.lineNumber,
            uid: p.uid,
            reason: 'uid đã tồn tại trong batch hiện tại.'
          })
          continue
        }
        // Dedupe: already in DB
        if (repo.uidExists(p.uid)) {
          skipped.push({
            line: p.lineNumber,
            uid: p.uid,
            reason: 'uid đã tồn tại trong cơ sở dữ liệu.'
          })
          batchUids.add(p.uid)
          continue
        }

        batchUids.add(p.uid)
        const id = randomUUID()
        const now = new Date().toISOString()

        // Build secret entries (only non-empty values) — R-D3: sink to safeStorage immediately
        const secretEntries: Array<{
          field: 'cookie' | 'twofa' | 'fb_password' | 'mail_password'
          value: Secret<string>
        }> = []
        secretEntries.push({ field: 'cookie', value: brandSecret(p.cookie) }) // cookie is mandatory
        if (p.twofa) secretEntries.push({ field: 'twofa', value: brandSecret(p.twofa) })
        if (p.pass) secretEntries.push({ field: 'fb_password', value: brandSecret(p.pass) })
        if (p.passmail)
          secretEntries.push({ field: 'mail_password', value: brandSecret(p.passmail) })

        // Build metadata entries for SQLite (non-secret)
        const metadata: Array<{ key: string; value: string }> = []
        if (p.hotmail) metadata.push({ key: 'email', value: p.hotmail })
        if (p.token) metadata.push({ key: 'token', value: p.token })

        // --- Atomicity per-profile (AC5) ---
        // Step 1: write secrets to safeStorage. Track keys for cleanup on failure.
        const writtenKeys: string[] = []
        try {
          for (const { field, value } of secretEntries) {
            await storage.set(secretKey(id, field), revealSecret(value))
            writtenKeys.push(secretKey(id, field))
          }

          // Step 2: write profile + metadata to DB atomically (sync transaction)
          repo.insertProfileAtomic(
            { id, uid: p.uid, displayName: p.uid, status: 'idle', createdAt: now },
            metadata
          )
        } catch (err) {
          // Cleanup: delete any secret keys already written for this id
          for (const k of writtenKeys) {
            try {
              await storage.delete(k)
            } catch {
              /* best-effort */
            }
          }
          // Best-effort: remove partial profile row if it exists
          try {
            repo.deleteProfile(id)
          } catch {
            /* may not exist */
          }

          const rawMsg = err instanceof Error ? err.message : ''
          const reason = /UNIQUE constraint failed/i.test(rawMsg)
            ? 'uid đã tồn tại trong cơ sở dữ liệu.'
            : 'Không thể lưu profile (lỗi lưu trữ nội bộ).'
          failed.push({ line: p.lineNumber, uid: p.uid, reason })
          continue
        }

        // IMPORTANT: profiles array must NOT contain cookie/2fa/password (AC4, rule #10)
        profiles.push({ id, uid: p.uid, displayName: p.uid, status: 'idle' })
      }

      // Convert parse errors to failed entries
      for (const e of parseErrors) {
        failed.push({ line: e.line, reason: e.reason })
      }

      return {
        total: profiles.length + skipped.length + failed.length,
        imported: profiles.length,
        skipped,
        failed,
        profiles
      }
    }
  }
}
