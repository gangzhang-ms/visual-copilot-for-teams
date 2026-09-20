import { describe, expect, it } from "vitest";
import { authorizeInvoke } from "./activity-authorization";
import { loadBotConfig } from "./config";
const config = loadBotConfig({ TEAMS_APP_ID: "11111111-1111-4111-8111-111111111111", CLIENT_ID: "22222222-2222-4222-8222-222222222222", TENANT_ID: "33333333-3333-4333-8333-333333333333", CLIENT_SECRET: "protected-development-secret", PUBLIC_ORIGIN: "https://emoji.example.test" });
const valid = { id: "activity", name: "composeExtension/fetchTask", channelId: "msteams", serviceUrl: "https://smba.trafficmanager.net/amer/", recipient: { id: config.clientId }, from: { aadObjectId: "44444444-4444-4444-8444-444444444444" }, conversation: { id: "chat", conversationType: "groupChat", tenantId: config.tenantId }, value: { commandId: "recommendVisual", commandContext: "compose", requestId: "request", draft: "must-not-read" } };
describe("invoke authorization", () => {
  it("accepts exact compose shape without reading draft", () => {
    const result = authorizeInvoke(valid, config);
    expect(result.commandContext).toBe("compose");
    expect(JSON.stringify(result)).not.toContain("must-not-read");
  });
  it.each([
    { ...valid, from: { id: "29:bot-user" } }, { ...valid, value: { ...valid.value, commandId: "recommendEmoji" } },
    { ...valid, name: "composeExtension/queryLink" }, { ...valid, channelId: "webchat" },
    { ...valid, serviceUrl: "https://evil.example" }, { ...valid, recipient: { id: "wrong" } },
    { ...valid, conversation: { tenantId: "wrong" } }, { ...valid, value: { ...valid.value, commandId: "alias" } },
    { ...valid, value: { ...valid.value, commandContext: "meeting" } }
  ])("rejects wrong route/channel/service/tenant/recipient/command/context", (fixture) => expect(() => authorizeInvoke(fixture, config)).toThrow());
});
