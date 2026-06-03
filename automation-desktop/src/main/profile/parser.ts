/** Maximum number of non-empty data lines accepted per import batch. */
export const MAX_LINES = 5000

export interface ParsedProfile {
  lineNumber: number
  uid: string
  pass: string
  twofa: string
  cookie: string
  token?: string
  userAgent?: string
  hotmail: string
  passmail: string
}

export interface ParseError {
  line: number
  reason: string
}

export interface ParseResult {
  parsed: ParsedProfile[]
  errors: ParseError[]
  lineCapExceeded: boolean
  dataLineCount: number
}

interface CookieExportEntry {
  name: string
  value: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseCookieExport(text: string): ParseResult | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null

  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch {
    return {
      parsed: [],
      errors: [{ line: 1, reason: 'JSON cookie export không hợp lệ.' }],
      lineCapExceeded: false,
      dataLineCount: 1
    }
  }

  const rawEntries = Array.isArray(json) ? json : [json]
  const entries: CookieExportEntry[] = rawEntries.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const name = entry['name']
    const value = entry['value']
    if (typeof name !== 'string' || !name.trim()) return []
    if (typeof value !== 'string') return []
    return [{ name: name.trim(), value }]
  })

  if (entries.length === 0) {
    return {
      parsed: [],
      errors: [{ line: 1, reason: 'JSON cookie export không có cookie hợp lệ.' }],
      lineCapExceeded: false,
      dataLineCount: 1
    }
  }

  const cUser = entries.find((entry) => entry.name === 'c_user')?.value.trim()
  if (!cUser) {
    return {
      parsed: [],
      errors: [{ line: 1, reason: 'JSON cookie export thiếu cookie c_user để lấy uid.' }],
      lineCapExceeded: false,
      dataLineCount: 1
    }
  }

  const cookie = entries.map((entry) => `${entry.name}=${entry.value}`).join('; ')

  return {
    parsed: [
      {
        lineNumber: 1,
        uid: cUser,
        pass: '',
        twofa: '',
        cookie,
        hotmail: '',
        passmail: ''
      }
    ],
    errors: [],
    lineCapExceeded: false,
    dataLineCount: 1
  }
}

/**
 * Pure function: parses bulk-import text into validated profile records.
 *
 * Format per line (split by `|`):
 *   6-field: uid|pass|2fa|cookie|hotmail|passmail
 *   7-field: uid|pass|2fa|cookie|token|hotmail|passmail
 *   external 7-field: uid|pass|email-or-profile-url|passmail|cookie|token|userAgent
 *
 * Skips empty lines and lines starting with `#` (comments).
 * Returns per-line errors for invalid lines; does NOT abort the batch.
 */
export function parseBulkProfiles(text: string): ParseResult {
  const cookieExport = parseCookieExport(text)
  if (cookieExport) return cookieExport

  const rawLines = text.split('\n')
  // Filter out empty / comment lines — these don't count toward MAX_LINES
  const dataLines = rawLines
    .map((raw, idx) => ({ raw, originalIdx: idx + 1 }))
    .filter(({ raw }) => {
      const trimmed = raw.trim()
      return trimmed.length > 0 && !trimmed.startsWith('#')
    })

  if (dataLines.length > MAX_LINES) {
    return {
      parsed: [],
      errors: [],
      lineCapExceeded: true,
      dataLineCount: dataLines.length
    }
  }

  const parsed: ParsedProfile[] = []
  const errors: ParseError[] = []

  for (const { raw, originalIdx } of dataLines) {
    const fields = raw.split('|').map((f) => f.trim())

    const uid = fields[0] ?? ''
    const pass = fields[1] ?? ''
    const externalFormat = isExternalCookieFormat(fields)
    const twofa = externalFormat ? '' : (fields[2] ?? '')
    const cookie = externalFormat ? (fields[4] ?? '') : (fields[3] ?? '')

    if (!uid) {
      errors.push({ line: originalIdx, reason: 'Thiếu uid (field 1): uid là bắt buộc.' })
      continue
    }
    if (!cookie) {
      errors.push({ line: originalIdx, reason: 'Thiếu cookie (field 4): cookie là bắt buộc.' })
      continue
    }

    let token: string | undefined
    let userAgent: string | undefined
    let hotmail: string
    let passmail: string

    if (externalFormat) {
      // External marketplace format: uid|pass|email-or-profile-url|passmail|cookie|token|userAgent
      hotmail = fields[2] ?? ''
      passmail = fields[3] ?? ''
      token = fields[5] ?? ''
      userAgent = fields[6] ?? ''
    } else if (fields.length >= 7) {
      // 7-field variant: uid|pass|2fa|cookie|token|hotmail|passmail
      token = fields[4] ?? ''
      hotmail = fields[5] ?? ''
      passmail = fields[6] ?? ''
    } else {
      // 6-field variant: uid|pass|2fa|cookie|hotmail|passmail
      hotmail = fields[4] ?? ''
      passmail = fields[5] ?? ''
    }

    parsed.push({
      lineNumber: originalIdx,
      uid,
      pass,
      twofa,
      cookie,
      ...(token !== undefined ? { token } : {}),
      ...(userAgent !== undefined ? { userAgent } : {}),
      hotmail,
      passmail
    })
  }

  return { parsed, errors, lineCapExceeded: false, dataLineCount: dataLines.length }
}

function isExternalCookieFormat(fields: string[]): boolean {
  if (fields.length < 7) return false
  const passmail = fields[3] ?? ''
  const cookie = fields[4] ?? ''
  const userAgent = fields[6] ?? ''

  return (
    passmail.length > 0 && /(?:^|;\s*)(?:c_user|xs)=/.test(cookie) && /^Mozilla\//.test(userAgent)
  )
}
