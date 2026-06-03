import type { ProfileRepository } from '../db/repositories/profile-repo'
import { FingerprintSchema, type Fingerprint } from '../../shared/types/fingerprint'
import { generateFingerprint } from './fingerprint-generator'

const FINGERPRINT_KEY = 'fingerprint'

export interface FingerprintService {
  ensureFingerprint(profileId: string): Fingerprint
}

export interface FingerprintServiceDeps {
  profileRepo: Pick<ProfileRepository, 'getMetadata' | 'setMetadata'>
}

export function createFingerprintService(deps: FingerprintServiceDeps): FingerprintService {
  return {
    ensureFingerprint(profileId) {
      const stored = deps.profileRepo.getMetadata(profileId, FINGERPRINT_KEY)
      if (stored) {
        try {
          const parsed = FingerprintSchema.safeParse(JSON.parse(stored))
          if (parsed.success) return parsed.data
        } catch {
          /* corrupt JSON falls through to deterministic self-heal */
        }
      }

      const fingerprint = generateFingerprint(profileId)
      deps.profileRepo.setMetadata(profileId, FINGERPRINT_KEY, JSON.stringify(fingerprint))
      return fingerprint
    }
  }
}
