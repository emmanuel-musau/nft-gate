import { defineConfig } from "vitest/config";

// Vitest resolves config from the package cwd without walking up, so this file
// is what makes `pnpm test` (and the root `projects` glob) see these tests.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
