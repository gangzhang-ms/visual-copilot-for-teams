import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir:"e2e",testMatch:"local-generation.spec.ts",workers:1,fullyParallel:false,timeout:45_000,
  use:{browserName:"chromium",...(process.env.CI?{}:{channel:"msedge"}),trace:"retain-on-failure"},
  outputDir:"../test-results-generation"
});
