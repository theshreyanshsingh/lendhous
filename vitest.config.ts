import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
// inline PostCSS config: Vite can't read postcss.config.mjs's Next-only plugin list, and the tests need no CSS
export default defineConfig({
  css: { postcss: { plugins: [] } },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["lib/**/*.test.ts", "tests/**/*.test.ts"], testTimeout: 20_000, hookTimeout: 120_000 },
});
