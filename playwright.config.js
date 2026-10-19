import { defineConfig } from "@playwright/test";

process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 25000,
  reporter: "list",
  use: { screenshot: "only-on-failure" },
});
