import { createHash } from 'node:crypto'
import { cpus, hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { machineId } from 'node-machine-id'

export interface HwidInput {
  machineUuid: string
  mac: string
  cpuBrand: string
}

export type NetworkInterfaceMap = Record<string, NetworkInterfaceInfo[] | undefined>

const VIRTUAL_INTERFACE_PATTERNS = [
  /^docker/i,
  /^veth/i,
  /^utun/i,
  /^vmnet/i,
  /^vboxnet/i,
  /^br-/i,
  /^tun/i,
  /^tap/i,
  /^tailscale/i,
  /^zt/i
]

export function buildHwid(input: HwidInput): string {
  return createHash('sha256')
    .update(`${input.machineUuid}|${input.mac}|${input.cpuBrand}`)
    .digest('hex')
}

function isVirtualInterface(name: string): boolean {
  return VIRTUAL_INTERFACE_PATTERNS.some((pattern) => pattern.test(name))
}

export function selectStableMacAddress(interfaces: NetworkInterfaceMap): string {
  const candidates = Object.entries(interfaces)
    .filter(([name]) => !isVirtualInterface(name))
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter((entry) => !entry.internal && entry.mac && entry.mac !== '00:00:00:00:00:00')
        .map((entry) => ({ name, mac: entry.mac.toLowerCase() }))
    )
    .sort((left, right) => left.name.localeCompare(right.name) || left.mac.localeCompare(right.mac))

  return candidates[0]?.mac ?? 'unknown-mac'
}

function cpuBrand(): string {
  return cpus()[0]?.model ?? 'unknown-cpu'
}

async function stableMachineUuid(): Promise<string> {
  try {
    return await machineId()
  } catch {
    return createHash('sha256').update(`${hostname()}|${cpuBrand()}`).digest('hex')
  }
}

export async function generateHwid(): Promise<string> {
  const machineUuid = await stableMachineUuid()
  return buildHwid({
    machineUuid,
    mac: selectStableMacAddress(networkInterfaces()),
    cpuBrand: cpuBrand()
  })
}
