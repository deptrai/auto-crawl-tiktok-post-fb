import { test, expect } from '@playwright/test'
import { EULA_VERSION, needsEulaAcceptance } from '../../src/shared/eula-version'

test('[P0] EULA gate is required when no accepted version exists', () => {
  expect(needsEulaAcceptance(null)).toBe(true)
  expect(needsEulaAcceptance(undefined)).toBe(true)
})

test('[P0] EULA gate is skipped only when accepted version covers current version', () => {
  expect(needsEulaAcceptance(String(EULA_VERSION), EULA_VERSION)).toBe(false)
  expect(needsEulaAcceptance(String(EULA_VERSION + 1), EULA_VERSION)).toBe(false)
})

test('[P0] EULA gate is required again when code version is bumped', () => {
  expect(needsEulaAcceptance('1', 2)).toBe(true)
})
