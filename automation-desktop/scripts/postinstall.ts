import { execSync } from 'node:child_process'

execSync('npx electron-rebuild -f -w better-sqlite3,better-sqlite3-multiple-ciphers', {
  stdio: 'inherit'
})
