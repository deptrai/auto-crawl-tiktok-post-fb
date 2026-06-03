import { test, expect } from '@playwright/test'
import { parseCookieHeader } from '../../src/main/automation'

test('[P0] cookie parser converts Facebook cookie header into Playwright cookies', () => {
  expect(parseCookieHeader('datr=abc; c_user=61554949615037; xs=secret')).toEqual([
    {
      name: 'datr',
      value: 'abc',
      domain: '.facebook.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'None'
    },
    {
      name: 'c_user',
      value: '61554949615037',
      domain: '.facebook.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None'
    },
    {
      name: 'xs',
      value: 'secret',
      domain: '.facebook.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None'
    }
  ])
})

test('[P0] cookie parser rejects empty and malformed entries', () => {
  expect(() => parseCookieHeader('')).toThrow(/cookie/i)
  expect(() => parseCookieHeader('c_user')).toThrow(/cookie/i)
})

test('[P1] cookie parser skips empty fragments and set-cookie attributes', () => {
  const cookies = parseCookieHeader('c_user=1; ; xs=2; Secure; HttpOnly')

  expect(cookies.map((cookie) => cookie.name)).toEqual(['c_user', 'xs'])
})

test('[P1] cookie parser keeps the last duplicate cookie value', () => {
  const cookies = parseCookieHeader('c_user=old; xs=1; c_user=new')

  expect(cookies).toHaveLength(2)
  expect(cookies.find((cookie) => cookie.name === 'c_user')?.value).toBe('new')
})

test('[P1] cookie parser accepts empty cookie values from browser exports', () => {
  const cookies = parseCookieHeader(
    'c_user=100024652313185; xs=session-value; oo=; datr=datr-value'
  )

  expect(cookies.find((cookie) => cookie.name === 'oo')?.value).toBe('')
  expect(cookies.find((cookie) => cookie.name === 'datr')?.value).toBe('datr-value')
})

test('[P1] cookie parser accepts JSON cookie exports at login time', () => {
  const cookies = parseCookieHeader(
    JSON.stringify([
      { domain: '.facebook.com', name: 'datr', value: 'datr-value', path: '/', secure: true },
      { domain: '.facebook.com', name: 'c_user', value: '100024652313185' },
      { domain: '.facebook.com', name: 'xs', value: 'session-value', httpOnly: true }
    ])
  )

  expect(cookies.map((cookie) => cookie.name)).toEqual(['datr', 'c_user', 'xs'])
  expect(cookies.find((cookie) => cookie.name === 'c_user')?.value).toBe('100024652313185')
  expect(cookies.find((cookie) => cookie.name === 'xs')?.httpOnly).toBe(true)
})

test('[P1] cookie parser accepts Netscape cookie exports at login time', () => {
  const cookies = parseCookieHeader(`
# Netscape HTTP Cookie File
.facebook.com	TRUE	/	TRUE	1893456000	datr	datr-value
.facebook.com	TRUE	/	TRUE	1893456000	c_user	100024652313185
.facebook.com	TRUE	/	TRUE	1893456000	xs	session-value
`)

  expect(cookies.map((cookie) => cookie.name)).toEqual(['datr', 'c_user', 'xs'])
  expect(cookies.find((cookie) => cookie.name === 'c_user')?.httpOnly).toBe(true)
  expect(cookies.find((cookie) => cookie.name === 'xs')?.value).toBe('session-value')
})
