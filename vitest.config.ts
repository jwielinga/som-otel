import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // These need Docker: run them with `pnpm test:collector`.
    exclude: [...configDefaults.exclude, 'src/**/*.collector.test.ts'],
  },
})
