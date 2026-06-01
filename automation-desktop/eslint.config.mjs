import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import noSecretInIpcPayload from './eslint-rules/no-secret-in-ipc-payload.js'
import noSecretToString from './eslint-rules/no-secret-tostring.js'
import noDirectLogger from './eslint-rules/no-direct-logger.js'

const electronImportRestriction = [
  'error',
  {
    paths: [
      {
        name: 'electron',
        message: 'Business code must import from adapter interfaces, not electron directly.'
      }
    ],
    patterns: ['electron/*']
  }
]

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/.playwright'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: { version: 'detect' }
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh,
      'phase3-security': {
        rules: {
          'no-secret-in-ipc-payload': noSecretInIpcPayload,
          'no-secret-tostring': noSecretToString,
          'no-direct-logger': noDirectLogger
        }
      }
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      'no-restricted-imports': electronImportRestriction,
      'phase3-security/no-secret-in-ipc-payload': 'error',
      'phase3-security/no-secret-tostring': 'error',
      'phase3-security/no-direct-logger': 'warn'
    }
  },
  {
    files: ['src/main/adapters/**/*.{ts,tsx}', 'src/preload/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off'
    }
  },
  eslintConfigPrettier
)
