import { defineConfig } from 'vitest/config'

// The server uses Node-ESM style `.js` import specifiers that point at `.ts`
// sources. Rewrite them so Vitest's resolver can find the TypeScript files.
export default defineConfig({
  plugins: [
    {
      name: 'rewrite-js-to-ts',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (importer && source.startsWith('.') && source.endsWith('.js')) {
          const resolved = await this.resolve(source.slice(0, -3) + '.ts', importer, { skipSelf: true })
          if (resolved) return resolved
        }
        return null
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
})
