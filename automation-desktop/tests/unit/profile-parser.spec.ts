import { test, expect } from '@playwright/test'
import { parseBulkProfiles } from '../../src/main/profile/parser'

test('[P1] parser handles happy path 6-field line', () => {
  const { parsed, errors } = parseBulkProfiles('uid1|pass1|seed1|cookie1|hot@mail.com|mailpass1')
  expect(errors).toHaveLength(0)
  expect(parsed).toHaveLength(1)
  const p = parsed[0]
  expect(p.uid).toBe('uid1')
  expect(p.pass).toBe('pass1')
  expect(p.twofa).toBe('seed1')
  expect(p.cookie).toBe('cookie1')
  expect(p.hotmail).toBe('hot@mail.com')
  expect(p.passmail).toBe('mailpass1')
  expect(p.token).toBeUndefined()
})

test('[P1] parser handles 7-field line (with token)', () => {
  const { parsed, errors } = parseBulkProfiles('uid2|pass2|seed2|cookie2|token2|hot2@m.com|mailpass2')
  expect(errors).toHaveLength(0)
  expect(parsed).toHaveLength(1)
  const p = parsed[0]
  expect(p.uid).toBe('uid2')
  expect(p.cookie).toBe('cookie2')
  expect(p.token).toBe('token2')
  expect(p.hotmail).toBe('hot2@m.com')
  expect(p.passmail).toBe('mailpass2')
})

test('[P1] parser skips empty lines and comment lines', () => {
  const text = [
    '# This is a comment',
    '',
    '   ',
    'uid1|p|2fa|ck|m@m.com|mp',
    '# another comment',
    '',
    'uid2|p|2fa|ck2||'
  ].join('\n')
  const { parsed, errors } = parseBulkProfiles(text)
  expect(parsed).toHaveLength(2)
  expect(errors).toHaveLength(0)
})

test('[P1] parser errors on missing uid', () => {
  const { parsed, errors } = parseBulkProfiles('|pass|2fa|cookie|')
  expect(parsed).toHaveLength(0)
  expect(errors).toHaveLength(1)
  expect(errors[0].line).toBe(1)
  expect(errors[0].reason).toMatch(/uid/)
})

test('[P1] parser errors on missing cookie', () => {
  const { parsed, errors } = parseBulkProfiles('uid1|pass|2fa||')
  expect(parsed).toHaveLength(0)
  expect(errors).toHaveLength(1)
  expect(errors[0].line).toBe(1)
  expect(errors[0].reason).toMatch(/cookie/)
})

test('[P1] parser trims whitespace from fields', () => {
  const { parsed } = parseBulkProfiles('  uid1  |  pass  |  seed  |  cookie  ')
  expect(parsed).toHaveLength(1)
  expect(parsed[0].uid).toBe('uid1')
  expect(parsed[0].pass).toBe('pass')
  expect(parsed[0].cookie).toBe('cookie')
})

test('[P1] parser handles line with only uid and cookie (minimal)', () => {
  const { parsed, errors } = parseBulkProfiles('uid1|||cookie1')
  expect(errors).toHaveLength(0)
  expect(parsed).toHaveLength(1)
  expect(parsed[0].uid).toBe('uid1')
  expect(parsed[0].cookie).toBe('cookie1')
  expect(parsed[0].pass).toBe('')
  expect(parsed[0].twofa).toBe('')
})

test('[P1] parser returns errors per line, does not abort batch', () => {
  const text = ['|pass|2fa|cookie', 'uid2|p|2fa|cookie2', 'uid3|p|2fa|'].join('\n')
  const { parsed, errors } = parseBulkProfiles(text)
  expect(parsed).toHaveLength(1)
  expect(errors).toHaveLength(2)
  expect(errors[0].line).toBe(1)
  expect(errors[1].line).toBe(3)
})

test('[P0] parser rejects text exceeding line cap', () => {
  const lines = Array.from({ length: 5001 }, (_, i) => `uid${i}|p|2fa|ck${i}`)
  const { parsed, errors } = parseBulkProfiles(lines.join('\n'))
  expect(parsed).toHaveLength(0)
  expect(errors).toHaveLength(1)
  expect(errors[0].reason).toMatch(/5000/)
})
