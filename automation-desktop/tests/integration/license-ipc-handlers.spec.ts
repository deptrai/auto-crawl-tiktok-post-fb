import { test, expect } from '@playwright/test'
import { registerLicenseHandlers } from '../../src/main/ipc/license-handlers'
import { LicenseServiceError, type LicenseService } from '../../src/main/license/license-service'

type IpcHandler = (_event: unknown, request: unknown) => Promise<unknown> | unknown

class FakeIpcMain {
  readonly handlers = new Map<string, IpcHandler>()

  handle(channel: string, handler: IpcHandler): void {
    this.handlers.set(channel, handler)
  }

  async invoke(channel: string, request: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`Missing handler for ${channel}`)
    return handler({}, request)
  }
}

const activeStatus = {
  active: true,
  expiresAt: new Date('2026-06-09T00:00:00.000Z').toISOString(),
  daysRemaining: 7
}

test('[P0] license IPC activate returns public status without activation id', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: LicenseService = {
    activate: async () => activeStatus,
    getStatus: async () => activeStatus
  }
  registerLicenseHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:license:activate', { key: 'LIC-OK' })

  expect(response).toEqual({ ok: true, status: activeStatus })
  expect(JSON.stringify(response)).not.toContain('activation_id')
})

test('[P1] license IPC rejects invalid payload with ErrorEnvelope retryable=false', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: LicenseService = {
    activate: async () => activeStatus,
    getStatus: async () => ({ active: false })
  }
  registerLicenseHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:license:activate', { key: '' })

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      retryable: false
    }
  })
})

test('[P1] license IPC maps typed service domain errors to Vietnamese ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: LicenseService = {
    activate: async () => {
      throw new LicenseServiceError(
        'LICENSE_HWID_MISMATCH',
        'License đã được kích hoạt trên máy khác.',
        false
      )
    },
    getStatus: async () => ({ active: false })
  }
  registerLicenseHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:license:activate', { key: 'LIC-MISMATCH' })

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: 'LICENSE_HWID_MISMATCH',
      message: 'License đã được kích hoạt trên máy khác.',
      retryable: false
    }
  })
})
