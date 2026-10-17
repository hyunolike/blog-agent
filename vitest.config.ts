import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json", "html"],
      reportsDirectory: "coverage",
      // Include unimported entry points and UI too, so missing tests remain visible.
      include: ["lib/**/*.ts", "ingest/**/*.ts", "app/**/*.{ts,tsx}", "public/widget.js", "eval/**/*.ts"],
      exclude: ["**/*.d.ts"],
      // Establish a baseline before choosing a meaningful coverage gate.
    },
  },
});
