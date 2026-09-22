import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir:"e2e",testMatch:"live-sync.spec.ts",workers:1,fullyParallel:false,timeout:45_000,
  use:{browserName:"chromium",...(process.env.CI?{}:{channel:"msedge"}),viewport:{width:1500,height:1000},trace:"retain-on-failure"},
  outputDir:"../test-results-live-sync"
});
