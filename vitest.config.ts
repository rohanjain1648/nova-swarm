import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts", "server/test/**/*.test.ts"],
    environment: "node",
  },
});
