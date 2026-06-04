/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const env = typeof process !== 'undefined' ? process.env : {}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['medirus.167.172.66.16.traefik.me'],
    proxy: {
      '/api': {
        target: env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
