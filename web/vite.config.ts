/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Absentra web (dev). PWA/offline (service worker) is a later-phase concern
// (PRD §7.3.5 / phase 6); it is intentionally OFF for now — a stale SW from an
// earlier build was caching a blank shell. public/sw.js self-unregisters.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 7707,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  preview: {
    port: 7707,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
})
