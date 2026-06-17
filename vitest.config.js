import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "app"),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "app/**/*.test.{js,jsx}",
      "tools/**/*.test.js",
      "workbench/**/*.test.js",
    ],
  },
});
