import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/uptime-game/",
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
  },
});
