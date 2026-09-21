/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The coach server (npm run server). Dev and preview both proxy /api to it,
// so the browser only ever talks to its own origin and never sees the key.
const COACH = 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': COACH } },
  preview: { proxy: { '/api': COACH } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
