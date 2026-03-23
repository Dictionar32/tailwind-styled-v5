import { defineConfig } from "vitest/config"

export default defineConfig({
  testEnvironment: "node",
  include: ["src/**/*.test.ts"],
  coverage: {
    enabled: true,
  },
})
