import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1",
    port: 4173,
    reuseExistingServer: false
  },
  projects: [{
    name: process.env.CI ? "chromium" : "edge",
    use: process.env.CI ? { browserName: "chromium" } : { browserName: "chromium", channel: "msedge" }
  }]
});
