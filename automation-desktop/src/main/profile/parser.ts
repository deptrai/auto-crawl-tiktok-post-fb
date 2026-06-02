/** Maximum number of non-empty data lines accepted per import batch. */
const MAX_LINES = 5000

export interface ParsedProfile {
  lineNumber: number
  uid: string
  pass: string
  twofa: string
  cookie: string
  token?: string
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
}

/**
 * Pure function: parses bulk-import text into validated profile records.
 *
 * Format per line (split by `|`):
 *   6-field: uid|pass|2fa|cookie|hotmail|passmail
 *   7-field: uid|pass|2fa|cookie|token|hotmail|passmail
 *
 * Skips empty lines and lines starting with `#` (comments).
 * Returns per-line errors for invalid lines; does NOT abort the batch.
 */
export function parseBulkProfiles(text: string): ParseResult {
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
      errors: [
        {
          line: 1,
          reason: `Quá nhiều dòng: tối đa ${MAX_LINES} dòng được phép mỗi lần import (nhận ${dataLines.length} dòng).`
        }
      ]
    }
  }

  const parsed: ParsedProfile[] = []
  const errors: ParseError[] = []

  for (const { raw, originalIdx } of dataLines) {
    const fields = raw.split('|').map((f) => f.trim())

    const uid = fields[0] ?? ''
    const pass = fields[1] ?? ''
    const twofa = fields[2] ?? ''
    const cookie = fields[3] ?? ''

    if (!uid) {
      errors.push({ line: originalIdx, reason: 'Thiếu uid (field 1): uid là bắt buộc.' })
      continue
    }
    if (!cookie) {
      errors.push({ line: originalIdx, reason: 'Thiếu cookie (field 4): cookie là bắt buộc.' })
      continue
    }

    let token: string | undefined
    let hotmail: string
    let passmail: string

    if (fields.length >= 7) {
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
      hotmail,
      passmail
    })
  }

  return { parsed, errors }
}
