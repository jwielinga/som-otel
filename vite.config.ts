import { defineConfig } from 'vite'

const fileNames = { es: 'som.js', cjs: 'som.cjs', iife: 'som.iife.js' } as const

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'Som',
      formats: ['es', 'cjs', 'iife'],
      fileName: (format) => fileNames[format as keyof typeof fileNames],
    },
  },
})
