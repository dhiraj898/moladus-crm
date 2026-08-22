import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    // No test files exist yet in this workstream; later workstreams add them.
    passWithNoTests: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws on import outside an RSC. Next.js aliases it to a
      // noop at build time; mirror that in Vitest so unit tests can import
      // modules (e.g. rbac/assignment) that carry `import 'server-only'`
      // alongside pure, testable exports.
      'server-only': fileURLToPath(
        new URL('./node_modules/server-only/empty.js', import.meta.url)
      ),
    },
  },
})
