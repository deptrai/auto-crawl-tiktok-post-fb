import type { SessionTokens } from './token-extractor'

export type BusinessCtaTokens = Required<SessionTokens>

export interface BusinessCtaRequestInput {
  actorId: string
  pageId: string
  tokens: BusinessCtaTokens
  clientMutationId?: string
}

export interface BusinessCtaRequest {
  url: string
  headers: Record<string, string>
  body: URLSearchParams
}

export type BusinessCtaResult = { ok: true } | { ok: false; reason: 'BUSINESS_CTA_FAILED' }

export interface BusinessCtaClient {
  send(input: BusinessCtaRequestInput): Promise<BusinessCtaResult>
}

export function buildBusinessCtaRequest(input: BusinessCtaRequestInput): BusinessCtaRequest {
  const variables = {
    input: {
      page_id: input.pageId,
      actor_id: input.actorId,
      client_mutation_id: input.clientMutationId ?? '1'
    }
  }
  const body = new URLSearchParams()
  body.set('fb_dtsg', input.tokens.fbDtsg)
  body.set('jazoest', input.tokens.jazoest)
  body.set('lsd', input.tokens.lsd)
  body.set('__spin_r', input.tokens.spinR)
  body.set('__spin_t', input.tokens.spinT)
  body.set('hsi', input.tokens.hsi)
  body.set('fb_api_req_friendly_name', 'MWChatBusinessCTAAdsSenderMutation')
  body.set('variables', JSON.stringify(variables))
  body.set('doc_id', 'MWChatBusinessCTAAdsSenderMutation')

  return {
    url: 'https://www.facebook.com/api/graphql/',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-fb-lsd': input.tokens.lsd
    },
    body
  }
}

export function isBusinessCtaSuccess(responseBody: string): boolean {
  return responseBody.includes('messenger_business_ads_sender":"')
}

export function createBusinessCtaClient(deps: {
  fetch: (request: BusinessCtaRequest) => Promise<string>
}): BusinessCtaClient {
  return {
    async send(input) {
      try {
        const responseBody = await deps.fetch(buildBusinessCtaRequest(input))
        return isBusinessCtaSuccess(responseBody)
          ? { ok: true }
          : { ok: false, reason: 'BUSINESS_CTA_FAILED' }
      } catch {
        return { ok: false, reason: 'BUSINESS_CTA_FAILED' }
      }
    }
  }
}
