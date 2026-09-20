import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Vitest config for the pure-logic and database-contract suites.
 *
 * The project has no DOM-level test layer (the app is a Next.js app whose
 * data paths are exercised by `npm run smoke` against a running server), so
 * these tests stay in Node and cover:
 *   * `src/lib/duties.ts`      duty/scope resolution (mirrors PART 13 SQL)
 *   * `src/lib/sports.ts`      fixture rule resolution (mirrors PART 12 SQL)
 *   * `supabase/db-setup.sql`  structural contract of the single setup file
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    reporters: 'default',
  },
})