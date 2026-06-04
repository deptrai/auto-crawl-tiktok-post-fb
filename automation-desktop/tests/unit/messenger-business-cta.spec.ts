import { test, expect } from '@playwright/test'
import {
  buildBusinessCtaRequest,
  createBusinessCtaClient,
  type BusinessCtaTokens
} from '../../src/main/automation/messenger-business-cta'

const tokens: BusinessCtaTokens = {
  fbDtsg: 'dtsg-secret',
  lsd: 'lsd-secret',
  jazoest: '21999',
  hsi: 'hsi-value',
  spinR: 'spin-r',
  spinT: 'spin-t'
}

test('[P0] business CTA request includes legacy semantic fields', () => {
  const request = buildBusinessCtaRequest({ actorId: 'profile-1', pageId: 'page-1', tokens })
  expect(request.url).toBe('https://www.facebook.com/api/graphql/')
  expect(request.headers['x-fb-lsd']).toBe('lsd-secret')
  expect(request.body.get('fb_dtsg')).toBe('dtsg-secret')
  expect(request.body.get('jazoest')).toBe('21999')
  expect(request.body.get('lsd')).toBe('lsd-secret')
  expect(request.body.get('__spin_r')).toBe('spin-r')
  expect(request.body.get('__spin_t')).toBe('spin-t')
  expect(request.body.get('fb_api_req_friendly_name')).toBe('MWChatBusinessCTAAdsSenderMutation')
  expect(request.body.get('variables')).toContain('"page_id":"page-1"')
  expect(request.body.get('variables')).toContain('"actor_id":"profile-1"')
})

test('[P0] business CTA client detects legacy success marker and sanitizes failure', async () => {
  const success = createBusinessCtaClient({
    fetch: async () => 'prefix messenger_business_ads_sender":" ok'
  })
  await expect(success.send({ actorId: 'profile-1', pageId: 'page-1', tokens })).resolves.toEqual({
    ok: true
  })

  const failure = createBusinessCtaClient({ fetch: async () => 'no marker dtsg-secret lsd-secret' })
  await expect(failure.send({ actorId: 'profile-1', pageId: 'page-1', tokens })).resolves.toEqual({
    ok: false,
    reason: 'BUSINESS_CTA_FAILED'
  })
})
