import { z } from 'zod'

export const FINGERPRINT_VERSION = 1 as const

export interface Fingerprint {
  version: number
  userAgent: string
  viewport: {
    width: number
    height: number
  }
  timezone: string
  fonts: string[]
  webglNoise: number
}

export const FingerprintSchema = z.object({
  version: z.literal(FINGERPRINT_VERSION),
  userAgent: z.string().min(1),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }),
  timezone: z.string().min(1),
  fonts: z.array(z.string().min(1)).min(1),
  webglNoise: z.number().min(0).lt(1)
})
