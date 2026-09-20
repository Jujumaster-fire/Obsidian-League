import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Data-loading effects in this codebase intentionally await a query and
      // then set state (client components fetch through Supabase with the
      // session cookie, which cannot happen during render). The rule is useful
      // guidance elsewhere, so it stays a warning — the handful of sites that
      // remain are documented inline with short `react-hooks` disable
      // comments instead.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Node tooling scripts (CommonJS, run directly with `node`).
    "scripts/**",
  ]),
]);

export default eslintConfig;
