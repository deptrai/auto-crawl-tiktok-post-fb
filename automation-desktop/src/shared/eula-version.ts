export const EULA_VERSION = 1

export function needsEulaAcceptance(
  acceptedVersion: string | null | undefined,
  currentVersion = EULA_VERSION
): boolean {
  if (!acceptedVersion) return true

  const parsedVersion = Number.parseInt(acceptedVersion, 10)
  if (!Number.isInteger(parsedVersion)) return true

  return parsedVersion < currentVersion
}
