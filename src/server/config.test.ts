import { describe, expect, it } from "vitest";
import { loadBotConfig } from "./config";
const base = { TEAMS_APP_ID: "11111111-1111-4111-8111-111111111111", CLIENT_ID: "22222222-2222-4222-8222-222222222222", TENANT_ID: "33333333-3333-4333-8333-333333333333", CLIENT_SECRET: "protected-development-secret", PUBLIC_ORIGIN: "https://emoji.example.test" };
describe("bot config", () => {
  it("accepts exact non-secret linkage", () => expect(loadBotConfig(base)).toMatchObject({ clientId: base.CLIENT_ID, testAuthBypass: false }));
  it.each([
    { ...base, CLIENT_SECRET: "" }, { ...base, PUBLIC_ORIGIN: "http://localhost" },
    { ...base, BOT_APP_ID: "44444444-4444-4444-8444-444444444444" },
    { ...base, ALLOWED_TENANT_ID: "44444444-4444-4444-8444-444444444444" },
    { ...base, SKIP_AUTH: "true" }, { ...base, TEAMS_APP_ID: base.CLIENT_ID }
  ])("fails closed for secret/auth/linkage drift", (fixture) => expect(() => loadBotConfig(fixture)).toThrow());
  it("permits a synthetic auth seam only in tests", () => expect(loadBotConfig({ ...base, CLIENT_SECRET: "", NODE_ENV: "test", TEST_ONLY_BYPASS_CONNECTOR_AUTH: "true" }).testAuthBypass).toBe(true));
});
