import { test, expect } from '@playwright/test'
import {
  createTokenExtractor,
  parseTokens,
  TokenExtractionError
} from '../../src/main/automation/token-extractor'

const FB_DTSG = 'fbDTSG_SECRET_123'
const LSD = 'lsd_SECRET_456'
const JAZOEST = '22000'
const HSI = 'hsi_123'
const SPIN_R = 'spin_r_456'
const SPIN_T = 'spin_t_789'

function htmlWithTokens(options: { jazoest?: string } = {}): string {
  const jazoestInput = options.jazoest
    ? `<input type="hidden" name="jazoest" value="${options.jazoest}" />`
    : ''
  return `
    <html>
      <head>
        <script>require("DTSGInitialData",[],{"token":"${FB_DTSG}"});</script>
        <script>require("LSD",[],{"token":"${LSD}"});</script>
        <script>"hsi":"${HSI}","__spin_r":"${SPIN_R}","__spin_t":"${SPIN_T}"</script>
      </head>
      <body>
        ${jazoestInput}
      </body>
    </html>
  `
}

test('[P0] parseTokens extracts fb_dtsg, lsd, and jazoest from authenticated HTML', () => {
  const tokens = parseTokens(htmlWithTokens({ jazoest: JAZOEST }))

  expect(tokens).toEqual({
    fbDtsg: FB_DTSG,
    lsd: LSD,
    jazoest: JAZOEST,
    hsi: HSI,
    spinR: SPIN_R,
    spinT: SPIN_T
  })
})

test('[P0] parseTokens supports input fallback patterns and computes jazoest when missing', () => {
  const html = `
    <form>
      <input name="fb_dtsg" value="abc" />
      <input name="lsd" value="lsd_input_value" />
    </form>
  `

  expect(parseTokens(html)).toEqual({ fbDtsg: 'abc', lsd: 'lsd_input_value', jazoest: '2294' })
})

test('[P0] parseTokens returns null when fb_dtsg or lsd is missing', () => {
  expect(parseTokens('<input name="fb_dtsg" value="only_fb" />')).toBeNull()
  expect(parseTokens('<input name="lsd" value="only_lsd" />')).toBeNull()
  expect(parseTokens('')).toBeNull()
})

test('[P0] extract retries boundedly, emits selector_miss name only, then returns tokens', async () => {
  const selectorMisses: string[] = []
  const htmlResponses = ['<html>bad</html>', htmlWithTokens({ jazoest: JAZOEST })]
  const extractor = createTokenExtractor({
    fetchHtml: async () => htmlResponses.shift() ?? '',
    onSelectorMiss: (token) => selectorMisses.push(token),
    maxAttempts: 2
  })

  await expect(extractor.extract()).resolves.toEqual({
    fbDtsg: FB_DTSG,
    lsd: LSD,
    jazoest: JAZOEST,
    hsi: HSI,
    spinR: SPIN_R,
    spinT: SPIN_T
  })
  expect(selectorMisses).toEqual(['fb_dtsg+lsd'])
  expect(JSON.stringify(selectorMisses)).not.toContain(FB_DTSG)
  expect(JSON.stringify(selectorMisses)).not.toContain(LSD)
})

test('[P0] extract exhausts retry budget with typed non-secret error', async () => {
  const selectorMisses: string[] = []
  const extractor = createTokenExtractor({
    fetchHtml: async () => `<input name="fb_dtsg" value="${FB_DTSG}" />`,
    onSelectorMiss: (token) => selectorMisses.push(token),
    maxAttempts: 2
  })

  await expect(extractor.extract()).rejects.toMatchObject({
    code: 'TOKEN_EXTRACTION_FAILED',
    retryable: true
  })
  await extractor.extract().catch((error: unknown) => {
    expect(error).toBeInstanceOf(TokenExtractionError)
    const errorText = error instanceof Error ? `${error.name}:${error.message}` : String(error)
    expect(errorText).not.toContain(FB_DTSG)
    expect(errorText).not.toContain(LSD)
  })
  // HTML has fb_dtsg but no lsd → only 'lsd' reported missing (specific token name).
  expect(selectorMisses).toEqual(['lsd', 'lsd', 'lsd', 'lsd'])
  expect(JSON.stringify(selectorMisses)).not.toContain(FB_DTSG)
})
