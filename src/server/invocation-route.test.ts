import { describe, expect, it } from "vitest";
import { loadBotConfig } from "./config";
import { InvocationStore } from "./invocation-store";
import { claimInvocation } from "./invocation-route";
import { PrivacyLogger } from "./privacy-logger";
const config = loadBotConfig({ TEAMS_APP_ID: "11111111-1111-4111-8111-111111111111", CLIENT_ID: "22222222-2222-4222-8222-222222222222", TENANT_ID: "33333333-3333-4333-8333-333333333333", CLIENT_SECRET: "protected-development-secret", PUBLIC_ORIGIN: "https://emoji.example.test" });
const envelope = { binding: { invocationId: "i", tenantId: config.tenantId, userId: "u", commandId: "recommendEmoji" as const, commandContext: "compose" as const }, selected: { mode: "manual" as const, context: "" } };
describe("invocation claim", () => {
  it("claims once and gives replay/random/restart the same response", () => {
    const store = new InvocationStore(); const token = store.createOrGet("key", envelope); const log = new PrivacyLogger();
    const request = { headers: { origin: config.publicOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: { token } };
    expect(claimInvocation(request, config, store, log)).toMatchObject({ status: 200, body: { schemaVersion: 1, selected: { mode: "manual" } } });
    expect(claimInvocation(request, config, store, log)).toEqual({ status: 410, body: { error: "Invocation unavailable." } });
    expect(claimInvocation({ ...request, body: { token: "A".repeat(43) } }, config, new InvocationStore(), log)).toEqual({ status: 410, body: { error: "Invocation unavailable." } });
  });
  it.each([
    { origin: "https://evil.example", "sec-fetch-site": "cross-site", "content-type": "application/json" },
    { origin: config.publicOrigin, "sec-fetch-site": "same-origin", "content-type": "text/plain" }
  ])("rejects cross-origin or non-JSON claims", (headers) => expect(claimInvocation({ headers, body: { token: "A".repeat(43) } }, config, new InvocationStore(), new PrivacyLogger()).status).toBe(403));
});
