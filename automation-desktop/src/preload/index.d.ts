import type { DesktopApi, DesktopElectronApi } from './index'

declare global {
  interface Window {
    electron: DesktopElectronApi
    api: DesktopApi
  }
}
