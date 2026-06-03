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

interface CookieExportEntry {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: string
}

export function parseCookieHeader(raw: string): PlaywrightCookie[] {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Invalid cookie header')

  const exportedCookies = parseCookieExport(trimmed) ?? parseNetscapeCookieExport(trimmed)
  const entries = exportedCookies ?? parseHeaderEntries(trimmed)
  const cookies = new Map<string, PlaywrightCookie>()

  for (const entry of entries) {
    const name = entry.name.trim()
    const value = entry.value.trim()
    if (!name) throw new Error('Invalid cookie entry')

    if (cookies.has(name)) cookies.delete(name)
    cookies.set(name, {
      name,
      value,
      domain: normalizeCookieDomain(entry.domain),
      path: entry.path?.trim() || '/',
      secure: entry.secure ?? true,
      httpOnly: entry.httpOnly ?? HTTP_ONLY_FACEBOOK_COOKIES.has(name),
      sameSite: normalizeSameSite(entry.sameSite)
    })
  }

  return [...cookies.values()]
}

function parseHeaderEntries(raw: string): CookieExportEntry[] {
  const entries = raw.split(';').flatMap((entry) => {
    const part = entry.trim()
    if (!part) return []
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) return []

    return {
      name: part.slice(0, separatorIndex).trim(),
      value: part.slice(separatorIndex + 1).trim()
    }
  })

  if (entries.length === 0) throw new Error('Invalid cookie header')
  return entries
}

function parseCookieExport(raw: string): CookieExportEntry[] | null {
  if (!raw.startsWith('[') && !raw.startsWith('{')) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Invalid cookie JSON export')
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed]
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid cookie JSON entry')
    const record = entry as Record<string, unknown>
    const name = record['name']
    const value = record['value']
    if (typeof name !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid cookie JSON entry')
    }

    return {
      name,
      value,
      domain: typeof record['domain'] === 'string' ? record['domain'] : undefined,
      path: typeof record['path'] === 'string' ? record['path'] : undefined,
      secure: typeof record['secure'] === 'boolean' ? record['secure'] : undefined,
      httpOnly: typeof record['httpOnly'] === 'boolean' ? record['httpOnly'] : undefined,
      sameSite: typeof record['sameSite'] === 'string' ? record['sameSite'] : undefined
    }
  })
}

function parseNetscapeCookieExport(raw: string): CookieExportEntry[] | null {
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  if (rows.length === 0 || !rows.some((line) => line.split(/\t+/).length >= 7)) return null

  return rows.map((line) => {
    const fields = line.split(/\t+/)
    if (fields.length < 7) throw new Error('Invalid Netscape cookie entry')
    const [domain, , path, secure, , name, ...valueParts] = fields
    return {
      name,
      value: valueParts.join('\t'),
      domain,
      path,
      secure: /^true$/i.test(secure)
    }
  })
}

function normalizeCookieDomain(domain: string | undefined): string {
  const trimmed = domain?.trim()
  if (!trimmed) return '.facebook.com'
  if (trimmed === 'facebook.com') return '.facebook.com'
  return trimmed
}

function normalizeSameSite(value: string | undefined): PlaywrightCookie['sameSite'] {
  if (value === 'Strict' || value === 'Lax' || value === 'None') return value
  if (value?.toLowerCase() === 'strict') return 'Strict'
  if (value?.toLowerCase() === 'lax') return 'Lax'
  return 'None'
}
