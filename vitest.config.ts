import { defineConfig } from "vitest/config";

/**
 * Root config exists only so `npx vitest` at the repo root runs every package.
 * Each package owns its own vitest.config.ts — turbo invokes `vitest run` with
 * the package as cwd, and vitest resolves config from cwd without walking up,
 * so a root-only config would silently apply to nothing.
 */
export default defineConfig({
  test: {
    projects: ["packages/*"],
  },
});
