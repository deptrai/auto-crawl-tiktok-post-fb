import { FINGERPRINT_VERSION, type Fingerprint } from '../../shared/types/fingerprint'

// 4.3 must reconcile Chrome/<major> with the actual Playwright Chromium bundle.
export const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
] as const

export const VIEWPORT_POOL = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1280, height: 720 }
] as const

export const TIMEZONE_POOL = [
  'Asia/Ho_Chi_Minh',
  'Asia/Ho_Chi_Minh',
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Singapore'
] as const

export const FONT_CORE = ['Arial', 'Calibri', 'Segoe UI', 'Times New Roman', 'Verdana'] as const

export const FONT_OPTIONAL_POOL = [
  'Cambria',
  'Tahoma',
  'Georgia',
  'Trebuchet MS',
  'Consolas',
  'Comic Sans MS'
] as const

function seedFromProfileId(profileId: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < profileId.length; i += 1) {
    const ch = profileId.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  return h1 >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, pool: readonly T[]): T {
  return pool[Math.floor(rng() * pool.length)]
}

export function generateFingerprint(profileId: string): Fingerprint {
  const rng = mulberry32(seedFromProfileId(profileId))
  const userAgent = pick(rng, UA_POOL)
  const viewport = pick(rng, VIEWPORT_POOL)
  const timezone = pick(rng, TIMEZONE_POOL)
  const optionalFonts = FONT_OPTIONAL_POOL.filter(() => rng() < 0.5)
  const webglNoise = rng()

  return {
    version: FINGERPRINT_VERSION,
    userAgent,
    viewport: { width: viewport.width, height: viewport.height },
    timezone,
    fonts: [...FONT_CORE, ...optionalFonts],
    webglNoise
  }
}
