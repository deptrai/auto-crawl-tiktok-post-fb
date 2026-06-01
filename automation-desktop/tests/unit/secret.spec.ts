import { test, expect } from '@playwright/test'
import { brandSecret } from '../../src/shared/types/secret'

test('[P1] brandSecret wraps value and blocks toString', () => {
  // Given: an object with sensitive token payload.
  const wrapped = brandSecret({ token: 'abc' })

  // When/Then: branded object keeps data access but blocks stringification.
  expect(wrapped.token).toBe('abc')
  expect(() => String(wrapped)).toThrow(/must not be stringified/i)
})
