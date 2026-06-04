import type { CaptchaParams, CheckpointPageLike, CheckpointType } from './types'

/**
 * Detect which kind of checkpoint Facebook is presenting.
 *
 * Detection is best-effort and based on DOM markers in the page HTML. The order
 * matters: solvable captchas (FunCaptcha, reCAPTCHA) are checked before
 * non-solvable ones (OTP, identity) so that a page embedding both an
 * enforcement iframe and an OTP input is treated as solvable first.
 */
export async function detectCheckpointType(page: CheckpointPageLike): Promise<CheckpointType> {
  const html = await page.content().catch(() => '')
  const url = page.url()

  if (FUNCAPTCHA_MARKERS.some((re) => re.test(html))) return 'FUNCAPTCHA'
  if (RECAPTCHA_MARKERS.some((re) => re.test(html))) return 'RECAPTCHA_V2'
  if (OTP_MARKERS.some((re) => re.test(html))) return 'OTP'
  if (IDENTITY_MARKERS.some((re) => re.test(html)) || /\/id\b|identity/i.test(url))
    return 'IDENTITY'

  return 'UNKNOWN'
}

const FUNCAPTCHA_MARKERS: readonly RegExp[] = [
  /funcaptcha/i,
  /arkoselabs/i,
  /arkose-labs/i,
  /data-pkey/i,
  /fc-token/i,
  /id=["']?FunCaptcha/i
]

const RECAPTCHA_MARKERS: readonly RegExp[] = [
  /class=["'][^"']*g-recaptcha/i,
  /www\.google\.com\/recaptcha/i,
  /grecaptcha/i,
  /g-recaptcha[^>]+data-sitekey|data-sitekey[^>]+g-recaptcha/i
]

const OTP_MARKERS: readonly RegExp[] = [
  /name=["']approvals_code["']/i,
  /name=["']checkpoint_code["']/i,
  /enter (the )?(login )?code/i,
  /nhập mã/i,
  /two-factor/i,
  /xác thực 2 yếu tố/i
]

const IDENTITY_MARKERS: readonly RegExp[] = [
  /upload (a )?(photo|id|document)/i,
  /confirm your identity/i,
  /xác minh danh tính/i,
  /tải lên (giấy tờ|ảnh)/i,
  /name=["']id_upload/i
]

/** pk_XXXXXXXX-XXXX-... Arkose public key embedded in HTML attributes/JSON. */
const FUNCAPTCHA_PUBLIC_KEY = /(?:data-pkey|public_?key|pkey)["'\s:=]+["']?(pk_[A-Za-z0-9-]+)/i
/** Fallback: bare Arkose public key anywhere in the markup. */
const FUNCAPTCHA_PUBLIC_KEY_BARE = /\b(pk_[A-Za-z0-9]{8,}-[A-Za-z0-9-]+)\b/
const FUNCAPTCHA_SURL = /(?:surl|service_?url)["'\s:=]+["']?(https?:\/\/[^"'\s\\]+)/i
const FUNCAPTCHA_BLOB =
  /(?:data-?blob|"blob"|blob)["'\s:=]+["']?(?!https?:\/\/)([A-Za-z0-9+/=._-]{8,})/i

const RECAPTCHA_SITE_KEY = /data-sitekey=["']([A-Za-z0-9_-]{20,})["']/i
const RECAPTCHA_SITE_KEY_RENDER = /recaptcha\/api\.js\?render=([A-Za-z0-9_-]{20,})/i

function subdomainFromSurl(surl: string | undefined): string | undefined {
  if (!surl) return undefined
  try {
    return new URL(surl).hostname
  } catch {
    return undefined
  }
}

/**
 * Extract solver parameters from the checkpoint page for the given type.
 * Returns null when required parameters (public key / site key) cannot be found.
 */
export async function extractCaptchaParams(
  page: CheckpointPageLike,
  type: CheckpointType
): Promise<CaptchaParams | null> {
  const html = await page.content().catch(() => '')
  const websiteUrl = page.url()

  if (type === 'FUNCAPTCHA') {
    const publicKey =
      html.match(FUNCAPTCHA_PUBLIC_KEY)?.[1] ?? html.match(FUNCAPTCHA_PUBLIC_KEY_BARE)?.[1]
    if (!publicKey) return null
    const surl = html.match(FUNCAPTCHA_SURL)?.[1]
    const blob = html.match(FUNCAPTCHA_BLOB)?.[1]
    return {
      type: 'FUNCAPTCHA',
      publicKey,
      websiteUrl,
      ...(subdomainFromSurl(surl) ? { subdomain: subdomainFromSurl(surl) } : {}),
      ...(blob ? { blob } : {})
    }
  }

  if (type === 'RECAPTCHA_V2') {
    const siteKey =
      html.match(RECAPTCHA_SITE_KEY)?.[1] ?? html.match(RECAPTCHA_SITE_KEY_RENDER)?.[1]
    if (!siteKey) return null
    return {
      type: 'RECAPTCHA_V2',
      siteKey,
      websiteUrl,
      invisible: /data-size=["']invisible["']/i.test(html)
    }
  }

  return null
}
