import { test, expect } from '@playwright/test'
import { MAX_LINES, parseBulkProfiles } from '../../src/main/profile/parser'

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
  const { parsed, errors } = parseBulkProfiles(
    'uid2|pass2|seed2|cookie2|token2|hot2@m.com|mailpass2'
  )
  expect(errors).toHaveLength(0)
  expect(parsed).toHaveLength(1)
  const p = parsed[0]
  expect(p.uid).toBe('uid2')
  expect(p.cookie).toBe('cookie2')
  expect(p.token).toBe('token2')
  expect(p.hotmail).toBe('hot2@m.com')
  expect(p.passmail).toBe('mailpass2')
})

test('[P1] parser handles external 7-field line with email before cookie', () => {
  const cookie = 'c_user=1000; xs=session-value; datr=datr-value'
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
  const { parsed, errors } = parseBulkProfiles(
    `uid-ext|fb-pass|mail@example.com|mail-pass|${cookie}|token-value|${userAgent}`
  )

  expect(errors).toHaveLength(0)
  expect(parsed).toHaveLength(1)
  const p = parsed[0]
  expect(p.uid).toBe('uid-ext')
  expect(p.pass).toBe('fb-pass')
  expect(p.twofa).toBe('')
  expect(p.hotmail).toBe('mail@example.com')
  expect(p.passmail).toBe('mail-pass')
  expect(p.cookie).toBe(cookie)
  expect(p.token).toBe('token-value')
  expect(p.userAgent).toBe(userAgent)
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

test('[P1] parser accepts Facebook JSON cookie export and derives uid from c_user', () => {
  const jsonCookieExport = JSON.stringify(
    [
      { domain: '.facebook.com', name: 'datr', value: 'datr-value' },
      { domain: '.facebook.com', name: 'c_user', value: '61554949615037' },
      { domain: '.facebook.com', name: 'xs', value: 'xs-value' }
    ],
    null,
    2
  )

  const { parsed, errors, dataLineCount } = parseBulkProfiles(jsonCookieExport)

  expect(errors).toHaveLength(0)
  expect(parsed).toHaveLength(1)
  expect(dataLineCount).toBe(1)
  expect(parsed[0].uid).toBe('61554949615037')
  expect(parsed[0].cookie).toBe('datr=datr-value; c_user=61554949615037; xs=xs-value')
  expect(parsed[0].pass).toBe('')
  expect(parsed[0].twofa).toBe('')
})

test('[P1] parser reports invalid JSON cookie export clearly', () => {
  const { parsed, errors } = parseBulkProfiles('[{"name":"c_user","value":"123"}')

  expect(parsed).toHaveLength(0)
  expect(errors).toEqual([{ line: 1, reason: 'JSON cookie export không hợp lệ.' }])
})

test('[P1] parser reports JSON cookie export missing c_user', () => {
  const { parsed, errors } = parseBulkProfiles(
    JSON.stringify([{ domain: '.facebook.com', name: 'xs', value: 'xs-value' }])
  )

  expect(parsed).toHaveLength(0)
  expect(errors).toEqual([
    { line: 1, reason: 'JSON cookie export thiếu cookie c_user để lấy uid.' }
  ])
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
  const lines = Array.from({ length: MAX_LINES + 1 }, (_, i) => `uid${i}|p|2fa|ck${i}`)
  const { parsed, errors, lineCapExceeded, dataLineCount } = parseBulkProfiles(lines.join('\n'))
  expect(parsed).toHaveLength(0)
  expect(errors).toHaveLength(0)
  expect(lineCapExceeded).toBe(true)
  expect(dataLineCount).toBe(MAX_LINES + 1)
})
