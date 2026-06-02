export const EULA_VERSION = 1

export function needsEulaAcceptance(
  acceptedVersion: string | null | undefined,
  currentVersion = EULA_VERSION
): boolean {
  if (!acceptedVersion) return true

  const trimmed = acceptedVersion.trim()
  const parsedVersion = Number(trimmed)
  if (!Number.isInteger(parsedVersion) || String(parsedVersion) !== trimmed) return true

  return parsedVersion < currentVersion
}
