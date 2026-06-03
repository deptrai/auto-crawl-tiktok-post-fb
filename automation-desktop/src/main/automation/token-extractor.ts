export interface SessionTokens {
  fbDtsg: string
  lsd: string
  jazoest: string
}

export interface TokenExtractor {
  extract(): Promise<SessionTokens>
}

export interface TokenExtractorDeps {
  fetchHtml: () => Promise<string>
  onSelectorMiss: (token: string) => void
  maxAttempts?: number
}

export class TokenExtractionError extends Error {
  code = 'TOKEN_EXTRACTION_FAILED' as const
  retryable = true as const

  constructor() {
    super('TOKEN_EXTRACTION_FAILED')
    this.name = 'TokenExtractionError'
  }
}

function matchFirst(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match?.[1]) return match[1]
  }
  return null
}

function matchFbDtsg(html: string): string | null {
  return matchFirst(html, [
    /"DTSGInitialData"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/,
    /name=["']fb_dtsg["'][^>]*value=["']([^"']+)["']/,
    /value=["']([^"']+)["'][^>]*name=["']fb_dtsg["']/,
    /\["DTSGInitial[^"']*"[^\]]*?,\s*"([^"']+)"\]/
  ])
}

function matchLsd(html: string): string | null {
  return matchFirst(html, [
    /"LSD"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/,
    /name=["']lsd["'][^>]*value=["']([^"']+)["']/,
    /value=["']([^"']+)["'][^>]*name=["']lsd["']/
  ])
}

function computeJazoest(fbDtsg: string): string {
  let sum = 0
  for (const ch of fbDtsg) sum += ch.charCodeAt(0)
  return `2${sum}`
}

/** Token NAMES (never values) missing from the HTML — safe to send to telemetry. */
export function missingTokenNames(html: string): string[] {
  const missing: string[] = []
  if (!matchFbDtsg(html)) missing.push('fb_dtsg')
  if (!matchLsd(html)) missing.push('lsd')
  return missing
}

export function parseTokens(html: string): SessionTokens | null {
  const fbDtsg = matchFbDtsg(html)
  const lsd = matchLsd(html)

  if (!fbDtsg || !lsd) return null

  const jazoest =
    matchFirst(html, [
      /name=["']jazoest["'][^>]*value=["'](\d+)["']/,
      /value=["'](\d+)["'][^>]*name=["']jazoest["']/
    ]) ?? computeJazoest(fbDtsg)

  return { fbDtsg, lsd, jazoest }
}

export function createTokenExtractor(deps: TokenExtractorDeps): TokenExtractor {
  const maxAttempts = deps.maxAttempts && deps.maxAttempts > 0 ? Math.floor(deps.maxAttempts) : 3

  return {
    async extract() {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const html = await deps.fetchHtml()
        const tokens = parseTokens(html)
        if (tokens) return tokens
        // Report the specific missing token NAME(s) (never values) for telemetry.
        deps.onSelectorMiss(missingTokenNames(html).join('+') || 'fb_dtsg+lsd')
      }

      throw new TokenExtractionError()
    }
  }
}
