import { test, expect } from '@playwright/test'
import {
  FINGERPRINT_VERSION,
  FingerprintSchema,
  FONT_CORE,
  FONT_OPTIONAL_POOL,
  TIMEZONE_POOL,
  UA_POOL,
  VIEWPORT_POOL,
  generateFingerprint
} from '../../src/main/automation'

function viewportKey(viewport: { width: number; height: number }): string {
  return `${viewport.width}x${viewport.height}`
}

test('[P0] fingerprint generator is deterministic byte-for-byte for one profile id', () => {
  const first = generateFingerprint('id-x')
  const second = generateFingerprint('id-x')

  expect(first).toEqual(second)
  expect(JSON.stringify(first)).toBe(JSON.stringify(second))
})

test('[P0] fingerprint generator diversifies fixed profile ids without flaky random input', () => {
  const fingerprints = Array.from({ length: 50 }, (_, index) => generateFingerprint(`id-${index}`))

  expect(
    new Set(fingerprints.map((fingerprint) => fingerprint.webglNoise)).size
  ).toBeGreaterThanOrEqual(48)
  expect(
    new Set(fingerprints.map((fingerprint) => fingerprint.userAgent)).size
  ).toBeGreaterThanOrEqual(2)
  expect(
    new Set(fingerprints.map((fingerprint) => viewportKey(fingerprint.viewport))).size
  ).toBeGreaterThanOrEqual(2)
})

test('[P0] fingerprint fields stay valid and coherent with curated pools', () => {
  const fingerprint = generateFingerprint('id-field-validity')
  const viewportPool = new Set(VIEWPORT_POOL.map(viewportKey))
  const fontPool = new Set([...FONT_CORE, ...FONT_OPTIONAL_POOL])

  expect(fingerprint.version).toBe(FINGERPRINT_VERSION)
  expect(fingerprint.userAgent).toMatch(/Chrome\//)
  expect(UA_POOL).toContain(fingerprint.userAgent)
  expect(viewportPool.has(viewportKey(fingerprint.viewport))).toBe(true)
  expect(fingerprint.viewport.width).toBeGreaterThan(0)
  expect(fingerprint.viewport.height).toBeGreaterThan(0)
  expect(TIMEZONE_POOL).toContain(fingerprint.timezone)
  expect(() => new Intl.DateTimeFormat(undefined, { timeZone: fingerprint.timezone })).not.toThrow()
  for (const font of FONT_CORE) expect(fingerprint.fonts).toContain(font)
  expect(fingerprint.fonts.length).toBeGreaterThanOrEqual(5)
  for (const font of fingerprint.fonts) expect(fontPool.has(font)).toBe(true)
  expect(fingerprint.webglNoise).toBeGreaterThanOrEqual(0)
  expect(fingerprint.webglNoise).toBeLessThan(1)
})

test('[P0] fingerprint schema round-trips generated output and enforces current version', () => {
  const fingerprint = generateFingerprint('id-schema')

  expect(FingerprintSchema.parse(fingerprint)).toEqual(fingerprint)
  expect(() =>
    FingerprintSchema.parse({ ...fingerprint, version: FINGERPRINT_VERSION + 1 })
  ).toThrow()
})

test('[P0] optional fonts use fixed draw order so later values remain deterministic', () => {
  // This guards the M1 rationale: the generator loops through every optional font,
  // so webglNoise is always the final draw for the same profile id.
  expect(generateFingerprint('id-0')).toEqual(generateFingerprint('id-0'))
  expect(generateFingerprint('id-49')).toEqual(generateFingerprint('id-49'))
})
