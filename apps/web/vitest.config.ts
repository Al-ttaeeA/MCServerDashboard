import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    name: "@smp/web",
    environment: "node",
    // Deterministic local-time behaviour for axis/format tests.
    env: { TZ: "America/New_York" },
  },
});
