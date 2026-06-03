import { test, expect } from '@playwright/test'
import { generateTotp } from '../../src/main/automation'

// RFC 6238 Appendix B vectors for HMAC-SHA1, 8 digits: 59 -> 94287082.
// Story 4.3 uses 6 digits, so the expected value is the modulo-1_000_000 suffix.
test('[P0] TOTP generates RFC 6238-compatible 6 digit code with injected clock', () => {
  expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082')
  expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1_111_111_109_000)).toBe('081804')
})

test('[P0] TOTP rejects invalid base32 seed without echoing the seed', () => {
  const seed = 'bad-secret!'
  expect(() => generateTotp(seed, 59_000)).toThrow(/base32/i)
  try {
    generateTotp(seed, 59_000)
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).not.toContain(seed)
  }
})
