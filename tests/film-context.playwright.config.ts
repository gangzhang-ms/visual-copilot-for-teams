import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir:"e2e",testMatch:"film-context.spec.ts",workers:1,fullyParallel:false,timeout:45_000,
  use:{browserName:"chromium",...(process.env.CI?{}:{channel:"msedge"}),trace:"retain-on-failure"},
  outputDir:"../test-results-film-context"
});
