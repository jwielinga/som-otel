import { defineConfig } from 'vitest/config'

// Tests that need Docker and a real OpenTelemetry Collector: `pnpm test:collector`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.collector.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
