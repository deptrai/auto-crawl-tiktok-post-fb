import { expect } from '@playwright/test'

export function expectDefined<T>(
  value: T | undefined | null,
  message?: string
): asserts value is T {
  expect(value, message).toBeTruthy()
}
