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
  expect(() => parseCookieHeader('c_user=1; ; xs=2')).toThrow(/cookie/i)
  expect(() => parseCookieHeader('c_user')).toThrow(/cookie/i)
})

test('[P1] cookie parser keeps the last duplicate cookie value', () => {
  const cookies = parseCookieHeader('c_user=old; xs=1; c_user=new')

  expect(cookies).toHaveLength(2)
  expect(cookies.find((cookie) => cookie.name === 'c_user')?.value).toBe('new')
})
