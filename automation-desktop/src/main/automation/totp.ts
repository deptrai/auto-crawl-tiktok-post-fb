import { createHmac } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const BASE32_BITS = [
  '00000',
  '00001',
  '00010',
  '00011',
  '00100',
  '00101',
  '00110',
  '00111',
  '01000',
  '01001',
  '01010',
  '01011',
  '01100',
  '01101',
  '01110',
  '01111',
  '10000',
  '10001',
  '10010',
  '10011',
  '10100',
  '10101',
  '10110',
  '10111',
  '11000',
  '11001',
  '11010',
  '11011',
  '11100',
  '11101',
  '11110',
  '11111'
] as const
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6

function decodeBase32(seed: string): Buffer {
  const normalized = seed.replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase()
  if (!normalized) throw new Error('Invalid base32 seed')

  let bits = ''
  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value === -1) throw new Error('Invalid base32 seed')
    bits += BASE32_BITS[value]
  }

  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

export function generateTotp(base32Seed: string, atMs: number): string {
  const key = decodeBase32(base32Seed)
  const counter = Math.floor(Math.floor(atMs / 1000) / TOTP_STEP_SECONDS)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))

  const hmac = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}
