import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve the `@/` path alias (mapped to ./src in tsconfig) so tests can import
// modules the same way the app does. Most existing tests use relative imports;
// this adds alias support without changing anything else.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
