export interface PlaywrightCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

const HTTP_ONLY_FACEBOOK_COOKIES = new Set(['c_user', 'xs'])

export function parseCookieHeader(raw: string): PlaywrightCookie[] {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Invalid cookie header')

  const entries = trimmed.split(';')
  const cookies = new Map<string, PlaywrightCookie>()

  for (const entry of entries) {
    const part = entry.trim()
    if (!part) throw new Error('Invalid cookie entry')
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) throw new Error('Invalid cookie entry')

    const name = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (!name || !value) throw new Error('Invalid cookie entry')

    if (cookies.has(name)) cookies.delete(name)
    cookies.set(name, {
      name,
      value,
      domain: '.facebook.com',
      path: '/',
      secure: true,
      httpOnly: HTTP_ONLY_FACEBOOK_COOKIES.has(name),
      sameSite: 'None'
    })
  }

  return [...cookies.values()]
}
