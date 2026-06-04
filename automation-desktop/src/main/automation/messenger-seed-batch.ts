import type { MessengerSeedResult, MessengerTarget } from './messenger-seed-orchestrator'

export type { MessengerSeedResult, MessengerTarget } from './messenger-seed-orchestrator'

export interface MessengerSeedBatchInput {
  profiles: string[]
  targets: MessengerTarget[]
  createJobId: (profileId: string) => string
  runProfile: (
    jobId: string,
    profileId: string,
    targets: MessengerTarget[]
  ) => Promise<MessengerSeedResult>
}

export interface MessengerSeedBatchResult {
  perProfile: MessengerSeedResult[]
  totalSent: number
  totalFailed: number
  totalCheckpoint: number
}

function assignRoundRobin(
  profiles: string[],
  targets: MessengerTarget[]
): Map<string, MessengerTarget[]> {
  const assignment = new Map<string, MessengerTarget[]>()
  for (const profileId of profiles) assignment.set(profileId, [])
  if (profiles.length === 0) return assignment
  for (let index = 0; index < targets.length; index += 1) {
    const profileId = profiles[index % profiles.length]
    assignment.get(profileId)?.push(targets[index])
  }
  return assignment
}

function isCheckpointResult(result: MessengerSeedResult): boolean {
  const checkpointStopReasons = new Set(['CHECKPOINT', 'TWO_FA_REQUIRED', 'RATE_LIMITED'])
  return (
    (result.stoppedReason ? checkpointStopReasons.has(result.stoppedReason) : false) ||
    result.perTarget.some((target) => target.outcome === 'checkpoint')
  )
}

export async function runMessengerSeedBatch(
  input: MessengerSeedBatchInput
): Promise<MessengerSeedBatchResult> {
  if (input.profiles.length === 0) {
    return {
      perProfile: [],
      totalSent: 0,
      totalFailed: input.targets.length,
      totalCheckpoint: 0
    }
  }

  const assignment = assignRoundRobin(input.profiles, input.targets)
  const perProfile: MessengerSeedResult[] = []

  for (const profileId of input.profiles) {
    const slice = assignment.get(profileId) ?? []
    try {
      const result = await input.runProfile(input.createJobId(profileId), profileId, slice)
      perProfile.push(result)
    } catch {
      perProfile.push({
        profileId,
        sent: 0,
        failed: slice.length,
        stoppedReason: 'PROFILE_ERROR',
        perTarget: []
      })
    }
  }

  return {
    perProfile,
    totalSent: perProfile.reduce((sum, item) => sum + item.sent, 0),
    totalFailed: perProfile.reduce((sum, item) => sum + item.failed, 0),
    totalCheckpoint: perProfile.filter(isCheckpointResult).length
  }
}
