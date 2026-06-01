import { app } from 'electron'
import { bootstrapApplication } from './electron-bootstrap'

export function runElectronRuntime(): void {
  void app.whenReady().then(bootstrapApplication)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
