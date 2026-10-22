import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // React Compiler advisories. The app predates the compiler, so these are
    // surfaced as warnings until the codebase is migrated. Note that
    // `react-hooks/rules-of-hooks` intentionally stays an error - violations
    // are real bugs, not style advice.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  {
    // `any` is tracked as a warning across the app while interfaces for the
    // external Polymarket payloads are filled in.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // scripts/ and utils/ are held to a stricter standard - no `any`.
    files: ["scripts/**/*.{ts,tsx}", "utils/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Plain Node CJS helper scripts - `require` is expected here.
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
