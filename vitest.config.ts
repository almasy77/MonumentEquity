import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirrors the "@/*" -> "src/*" alias from tsconfig.json so modules under test that use
// the alias (API routes, the MCP connector) resolve the same way they do in Next.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
