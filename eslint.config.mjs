// Root ESLint config for the non-Next.js workspaces (core, db, ingest, api).
// apps/web has its own config (eslint-config-next) and is linted separately.
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "apps/web/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/.wrangler/**",
    "**/coverage/**",
    "samples/**",
    ".data/**",
  ]),
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
]);
