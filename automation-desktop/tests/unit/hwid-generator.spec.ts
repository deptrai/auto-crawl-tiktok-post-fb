import { test, expect } from '@playwright/test'
import { buildHwid, selectStableMacAddress } from '../../src/main/license/hwid-generator'

test('[P0] HWID hash is deterministic 64-character SHA-256 hex', () => {
  // Given: stable machine identity ingredients.
  const input = {
    machineUuid: 'machine-uuid-1',
    mac: 'aa:bb:cc:dd:ee:ff',
    cpuBrand: 'Apple M3 Pro'
  }

  // When: building the HWID repeatedly.
  const first = buildHwid(input)
  const second = buildHwid(input)

  // Then: the hash is deterministic and has the expected SHA-256 shape.
  expect(first).toBe(second)
  expect(first).toMatch(/^[0-9a-f]{64}$/)
})

test('[P1] HWID hash changes when machine identity changes', () => {
  // Given: two different machine identity inputs.
  const base = buildHwid({ machineUuid: 'machine-1', mac: 'aa:bb', cpuBrand: 'cpu-a' })
  const changed = buildHwid({ machineUuid: 'machine-2', mac: 'aa:bb', cpuBrand: 'cpu-a' })

  // Then: different machines do not collapse to the same HWID.
  expect(changed).not.toBe(base)
})

test('[P1] stable MAC selection ignores virtual Docker/VPN interfaces', () => {
  const interfaces = {
    utun4: [{ internal: false, mac: '10:10:10:10:10:10' }],
    docker0: [{ internal: false, mac: '20:20:20:20:20:20' }],
    en1: [{ internal: false, mac: 'cc:cc:cc:cc:cc:cc' }],
    en0: [{ internal: false, mac: 'aa:aa:aa:aa:aa:aa' }]
  }

  expect(selectStableMacAddress(interfaces)).toBe('aa:aa:aa:aa:aa:aa')
})

test('[P1] stable MAC selection is unchanged when virtual interfaces toggle', () => {
  const withoutVpn = {
    en0: [{ internal: false, mac: 'aa:aa:aa:aa:aa:aa' }]
  }
  const withVpnAndDocker = {
    docker0: [{ internal: false, mac: '20:20:20:20:20:20' }],
    utun2: [{ internal: false, mac: '10:10:10:10:10:10' }],
    en0: [{ internal: false, mac: 'aa:aa:aa:aa:aa:aa' }]
  }

  expect(selectStableMacAddress(withoutVpn)).toBe(selectStableMacAddress(withVpnAndDocker))
})
