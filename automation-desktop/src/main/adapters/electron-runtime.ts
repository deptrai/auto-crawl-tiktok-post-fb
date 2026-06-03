import { app } from 'electron'
import { bootstrapApplication } from './electron-bootstrap'

export function runElectronRuntime(): void {
  if (!app.isPackaged) {
    const userDataPath = process.env['PHASE3_USER_DATA_PATH']
    if (userDataPath) app.setPath('userData', userDataPath)
  }

  void app.whenReady().then(bootstrapApplication)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
