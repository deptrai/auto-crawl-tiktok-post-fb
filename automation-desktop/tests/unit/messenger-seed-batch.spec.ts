import { test, expect } from '@playwright/test'
import {
  runMessengerSeedBatch,
  type MessengerSeedResult
} from '../../src/main/automation/messenger-seed-batch'

test('[P0] messenger seed batch assigns targets round-robin across profiles', async () => {
  const calls: Array<{ jobId: string; profileId: string; targets: string[] }> = []

  const result = await runMessengerSeedBatch({
    profiles: ['p1', 'p2'],
    targets: [{ uid: '1001' }, { uid: '1002' }, { uid: '1003' }, { uid: '1004' }, { uid: '1005' }],
    createJobId: (profileId) => `job-${profileId}`,
    runProfile: async (jobId, profileId, targets): Promise<MessengerSeedResult> => {
      calls.push({ jobId, profileId, targets: targets.map((target) => target.uid) })
      return {
        profileId,
        sent: targets.length,
        failed: 0,
        perTarget: targets.map((target) => ({ uid: target.uid, outcome: 'success' }))
      }
    }
  })

  expect(calls).toEqual([
    { jobId: 'job-p1', profileId: 'p1', targets: ['1001', '1003', '1005'] },
    { jobId: 'job-p2', profileId: 'p2', targets: ['1002', '1004'] }
  ])
  expect(result.totalSent).toBe(5)
  expect(result.totalFailed).toBe(0)
  expect(result.totalCheckpoint).toBe(0)
})

test('[P0] messenger seed batch isolates a throwing profile and continues next profile', async () => {
  const calls: string[] = []

  const result = await runMessengerSeedBatch({
    profiles: ['p1', 'p2'],
    targets: [{ uid: '1001' }, { uid: '1002' }, { uid: '1003' }],
    createJobId: (profileId) => `job-${profileId}`,
    runProfile: async (_jobId, profileId, targets): Promise<MessengerSeedResult> => {
      calls.push(profileId)
      if (profileId === 'p1') throw new Error('profile browser crashed with token SECRET')
      return {
        profileId,
        sent: targets.length,
        failed: 0,
        perTarget: targets.map((target) => ({ uid: target.uid, outcome: 'success' }))
      }
    }
  })

  expect(calls).toEqual(['p1', 'p2'])
  expect(result.perProfile[0]).toEqual({
    profileId: 'p1',
    sent: 0,
    failed: 2,
    stoppedReason: 'PROFILE_ERROR',
    perTarget: []
  })
  expect(result.perProfile[1]).toEqual(
    expect.objectContaining({ profileId: 'p2', sent: 1, failed: 0 })
  )
  expect(JSON.stringify(result)).not.toContain('SECRET')
})

test('[P0] messenger seed batch aggregates sent failed and checkpoint counts', async () => {
  const result = await runMessengerSeedBatch({
    profiles: ['p1', 'p2'],
    targets: [{ uid: '1001' }, { uid: '1002' }],
    createJobId: (profileId) => `job-${profileId}`,
    runProfile: async (_jobId, profileId): Promise<MessengerSeedResult> => {
      if (profileId === 'p1') {
        return { profileId, sent: 1, failed: 0, perTarget: [{ uid: '1001', outcome: 'success' }] }
      }
      return {
        profileId,
        sent: 0,
        failed: 1,
        stoppedReason: 'CHECKPOINT',
        perTarget: [{ uid: '1002', outcome: 'checkpoint', reason: 'CHECKPOINT' }]
      }
    }
  })

  expect(result.totalSent).toBe(1)
  expect(result.totalFailed).toBe(1)
  expect(result.totalCheckpoint).toBe(1)
})

test('[P0] messenger seed batch counts pre-target checkpoint stops in aggregate', async () => {
  const result = await runMessengerSeedBatch({
    profiles: ['p1', 'p2'],
    targets: [{ uid: '1001' }, { uid: '1002' }],
    createJobId: (profileId) => `job-${profileId}`,
    runProfile: async (_jobId, profileId): Promise<MessengerSeedResult> => ({
      profileId,
      sent: 0,
      failed: 1,
      stoppedReason: profileId === 'p1' ? 'TWO_FA_REQUIRED' : 'RATE_LIMITED',
      perTarget: []
    })
  })

  expect(result.totalSent).toBe(0)
  expect(result.totalFailed).toBe(2)
  expect(result.totalCheckpoint).toBe(2)
})

test('[P0] messenger seed batch marks all targets failed when no profiles are available', async () => {
  const result = await runMessengerSeedBatch({
    profiles: [],
    targets: [{ uid: '1001' }, { uid: '1002' }],
    createJobId: (profileId) => `job-${profileId}`,
    runProfile: async (): Promise<MessengerSeedResult> => {
      throw new Error('runProfile should not be called without profiles')
    }
  })

  expect(result).toEqual({ perProfile: [], totalSent: 0, totalFailed: 2, totalCheckpoint: 0 })
})
