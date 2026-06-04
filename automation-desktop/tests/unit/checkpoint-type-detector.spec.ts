import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { detectCheckpointType, extractCaptchaParams } from '../../src/main/automation/checkpoint'
import type { CheckpointPageLike } from '../../src/main/automation/checkpoint'

function page(html: string, url = 'https://www.facebook.com/checkpoint/'): CheckpointPageLike {
  return { url: () => url, content: async () => html }
}

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures/fb-mock', name), 'utf8')
}

test('[P0] detects FunCaptcha checkpoint and extracts Arkose params', async () => {
  const input = page(fixture('checkpoint-funcaptcha.html'))

  await expect(detectCheckpointType(input)).resolves.toBe('FUNCAPTCHA')
  await expect(extractCaptchaParams(input, 'FUNCAPTCHA')).resolves.toEqual({
    type: 'FUNCAPTCHA',
    publicKey: 'pk_12345678-1234-1234-1234-123456789abc',
    websiteUrl: 'https://www.facebook.com/checkpoint/',
    subdomain: 'facebook-api.arkoselabs.com',
    blob: 'blobvalue123'
  })
})

test('[P0] detects reCAPTCHA v2 checkpoint and extracts site key', async () => {
  const input = page(fixture('checkpoint-recaptcha.html'))

  await expect(detectCheckpointType(input)).resolves.toBe('RECAPTCHA_V2')
  await expect(extractCaptchaParams(input, 'RECAPTCHA_V2')).resolves.toEqual({
    type: 'RECAPTCHA_V2',
    siteKey: '6Lcabcdefghijklmnopqrstuvwxyz1234567890',
    websiteUrl: 'https://www.facebook.com/checkpoint/',
    invisible: false
  })
})

test('[P0] classifies OTP identity unknown and missing params safely', async () => {
  await expect(detectCheckpointType(page('<input name="checkpoint_code">'))).resolves.toBe('OTP')
  await expect(detectCheckpointType(page('<input name="id_upload">'))).resolves.toBe('IDENTITY')
  await expect(
    detectCheckpointType(page('<main>blocked</main>', 'https://facebook.com/home'))
  ).resolves.toBe('UNKNOWN')
  await expect(
    extractCaptchaParams(page('<div>funcaptcha</div>'), 'FUNCAPTCHA')
  ).resolves.toBeNull()
})
