import { createHash } from 'node:crypto'
import { cpus, networkInterfaces } from 'node:os'
import { machineId } from 'node-machine-id'

export interface HwidInput {
  machineUuid: string
  mac: string
  cpuBrand: string
}

export function buildHwid(input: HwidInput): string {
  return createHash('sha256')
    .update(`${input.machineUuid}|${input.mac}|${input.cpuBrand}`)
    .digest('hex')
}

function firstMacAddress(): string {
  const interfaces = networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry.internal && entry.mac && entry.mac !== '00:00:00:00:00:00') return entry.mac
    }
  }
  return 'unknown-mac'
}

function cpuBrand(): string {
  return cpus()[0]?.model ?? 'unknown-cpu'
}

export async function generateHwid(): Promise<string> {
  const machineUuid = await machineId()
  return buildHwid({ machineUuid, mac: firstMacAddress(), cpuBrand: cpuBrand() })
}
