import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerApp } from "./app";
import { loadBotConfig } from "./config";
const config = loadBotConfig({ NODE_ENV: "test", TEST_ONLY_BYPASS_CONNECTOR_AUTH: "true", TEAMS_APP_ID: "11111111-1111-4111-8111-111111111111", CLIENT_ID: "22222222-2222-4222-8222-222222222222", TENANT_ID: "33333333-3333-4333-8333-333333333333", CLIENT_SECRET: "protected-development-secret", PUBLIC_ORIGIN: "https://emoji.example.test" });
let running: Awaited<ReturnType<typeof createServerApp>>["app"] | undefined;
afterEach(async () => { await running?.stop(); running = undefined; });
describe("Teams SDK HTTP integration", () => {
  it("routes exact fetchTask invoke and rejects aliases without state", async () => {
    const server = createServerApp(config); running = server.app; await server.app.start("0");
    await vi.waitFor(() => expect(server.adapter.listeningPort).toBeTypeOf("number"));
    const base = `http://127.0.0.1:${server.adapter.listeningPort}`;
    const activity = {
      type: "invoke", id: "activity", timestamp: new Date().toISOString(), name: "composeExtension/fetchTask",
      channelId: "msteams", serviceUrl: "https://smba.trafficmanager.net/teams", recipient: { id: config.clientId, name: "bot" },
      from: { id: "channel-user", aadObjectId: "44444444-4444-4444-8444-444444444444" }, conversation: { id: "conversation", conversationType: "groupChat", tenantId: config.tenantId },
      channelData: { tenant: { id: config.tenantId } },
      value: { commandId: "recommendVisual", commandContext: "compose", requestId: "request" }
    };
    const accepted = await fetch(`${base}/api/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(activity) });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ task: { type: "continue" } });
    expect(server.store.counts().envelopes).toBe(1);
    server.visual.dispose();
    const rejected = await fetch(`${base}/api/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...activity, id: "alias", name: "composeExtension/queryLink" }) });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(server.store.counts().envelopes).toBe(1);
  });
});
