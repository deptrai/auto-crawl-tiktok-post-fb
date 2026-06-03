const FACEBOOK_ORIGIN = 'https://www.facebook.com'

export interface OwnPostTargetPageLike {
  url?: () => string
  evaluate?: <T>(fn: () => T | Promise<T>) => Promise<T>
  waitForTimeout?: (ms: number) => Promise<void>
  getAttribute?: (selector: string, name: string) => Promise<string | null>
}

function normalizeFacebookUrl(href: string): string | null {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('javascript:')) return null

  try {
    const url = new URL(trimmed, FACEBOOK_ORIGIN)
    if (!url.hostname.endsWith('facebook.com')) return null
    url.hash = ''
    return `${url.origin}${url.pathname}${url.search}`
  } catch {
    return null
  }
}

function isLikelyPostUrl(urlString: string): boolean {
  return scorePostUrl(urlString) > 0
}

function scorePostUrl(urlString: string): number {
  try {
    const url = new URL(urlString)
    const path = url.pathname
    const search = url.searchParams

    if (search.has('story_fbid')) return 100
    if (/\/posts\//.test(path)) return 90
    if (/\/permalink\.php$/.test(path)) return 85
    if (/\/story\.php$/.test(path)) return 80
    if (/\/share\/p\//.test(path)) return 75
    if (/\/photo\.php$/.test(path) && search.has('fbid')) return 70
    if (/\/videos?\//.test(path)) return 65
    if (/\/watch\/?$/.test(path) && search.has('v')) return 60
    return 0
  } catch {
    return 0
  }
}

function pickPostUrl(candidates: string[]): string | null {
  let best: { url: string; score: number } | null = null

  for (const candidate of candidates) {
    const normalized = normalizeFacebookUrl(candidate)
    if (!normalized) continue
    const score = scorePostUrl(normalized)
    if (score > 0 && (!best || score > best.score)) best = { url: normalized, score }
  }
  return best?.url ?? null
}

async function collectAnchorHrefs(page: OwnPostTargetPageLike): Promise<string[]> {
  if (!page.evaluate) return []

  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    return anchors.map((anchor) => anchor.href || anchor.getAttribute('href') || '').filter(Boolean)
  })
}

export async function resolveOwnPostTarget(
  page: OwnPostTargetPageLike,
  options: { scrollAttempts?: number; settleMs?: number } = {}
): Promise<string | null> {
  const currentUrl = normalizeFacebookUrl(page.url?.() ?? '')
  if (currentUrl && isLikelyPostUrl(currentUrl)) return currentUrl

  const selector = [
    'a[href*="/posts/"]',
    'a[href*="/permalink.php"]',
    'a[href*="/story.php"]',
    'a[href*="/photo.php"]',
    'a[href*="/video/"]',
    'a[href*="/videos/"]',
    'a[href*="/watch/"][href*="v="]',
    'a[href*="/share/p/"]',
    'a[href*="story_fbid"]',
    'a[href*="fbid="]'
  ].join(', ')

  const directHref = await page.getAttribute?.(selector, 'href').catch(() => null)
  const directUrl = directHref ? pickPostUrl([directHref]) : null
  if (directUrl) return directUrl

  const attempts = Math.max(1, options.scrollAttempts ?? 4)
  const settleMs = Math.max(0, options.settleMs ?? 800)

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const postUrl = pickPostUrl(await collectAnchorHrefs(page))
    if (postUrl) return postUrl

    if (page.evaluate) {
      await page
        .evaluate(() => {
          window.scrollBy(0, Math.max(window.innerHeight * 0.8, 420))
        })
        .catch(() => undefined)
    }
    await page.waitForTimeout?.(settleMs)
  }

  return pickPostUrl(await collectAnchorHrefs(page))
}
