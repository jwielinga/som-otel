import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const exampleDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: resolve(exampleDir, 'app'),
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(exampleDir, 'app'),
      'som-otel': resolve(exampleDir, '../../dist/som.js'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
    // Lets the page query Loki and Prometheus without CORS.
    proxy: {
      '/loki/api': {
        target: process.env.LOKI_PROXY_TARGET ?? 'http://localhost:3100',
        changeOrigin: true,
      },
      '/prometheus/api': {
        target: process.env.PROMETHEUS_PROXY_TARGET ?? 'http://localhost:9090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/prometheus/, ''),
      },
    },
  },
})
