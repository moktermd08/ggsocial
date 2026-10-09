import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
  resolve: {
    alias: {
      "@/": path.resolve(import.meta.dirname, "src") + "/",
      // `server-only` throws outside a Next server build; tests are server code.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
});
