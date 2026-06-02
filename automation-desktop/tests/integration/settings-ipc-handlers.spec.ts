import { test, expect } from '@playwright/test'
import { registerSettingsHandlers } from '../../src/main/ipc/settings-handlers'
import { registerShellHandlers } from '../../src/main/ipc/shell-handlers'

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

test('[P0] settings IPC handlers round-trip through repository contract', async () => {
  const fakeIpc = new FakeIpcMain()
  const settings = new Map<string, string>()
  registerSettingsHandlers(fakeIpc, {
    getSetting: (key) => settings.get(key) ?? null,
    setSetting: (key, value) => settings.set(key, value)
  })

  await expect(
    fakeIpc.invoke('phase3:settings:set', { key: 'telemetry_enabled', value: 'true' })
  ).resolves.toEqual({
    ok: true
  })
  await expect(
    fakeIpc.invoke('phase3:settings:get', { key: 'telemetry_enabled' })
  ).resolves.toEqual({
    ok: true,
    value: 'true'
  })
})

test('[P1] settings IPC handlers return ErrorEnvelope for invalid request payloads', async () => {
  const fakeIpc = new FakeIpcMain()
  registerSettingsHandlers(fakeIpc, {
    getSetting: () => null,
    setSetting: () => undefined
  })

  const response = await fakeIpc.invoke('phase3:settings:get', { key: '' })
  expect(response).toMatchObject({
    ok: false,
    error: {
      code: 'VALIDATION_ERROR'
    }
  })
})

test('[P1] shell IPC handler validates URL and delegates external opening', async () => {
  const fakeIpc = new FakeIpcMain()
  const openedUrls: string[] = []
  registerShellHandlers(fakeIpc, async (url) => {
    openedUrls.push(url)
  })

  await expect(
    fakeIpc.invoke('phase3:shell:open-external', { url: 'https://example.com/privacy' })
  ).resolves.toEqual({ ok: true })
  expect(openedUrls).toEqual(['https://example.com/privacy'])

  await expect(
    fakeIpc.invoke('phase3:shell:open-external', { url: 'file:///tmp/privacy' })
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'VALIDATION_ERROR' }
  })
})
