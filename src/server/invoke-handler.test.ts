import { describe, expect, it } from "vitest";
import { loadBotConfig } from "./config";
import { InvocationStore } from "./invocation-store";
import { PrivacyLogger } from "./privacy-logger";
import { handleFetchTask } from "./invoke-handler";
const config = loadBotConfig({ TEAMS_APP_ID: "11111111-1111-4111-8111-111111111111", CLIENT_ID: "22222222-2222-4222-8222-222222222222", TENANT_ID: "33333333-3333-4333-8333-333333333333", CLIENT_SECRET: "protected-development-secret", PUBLIC_ORIGIN: "https://emoji.example.test" });
const activity = { id: "a", name: "composeExtension/fetchTask", channelId: "msteams", serviceUrl: "https://smba.trafficmanager.net/teams", recipient: { id: config.clientId }, from: { aadObjectId: "44444444-4444-4444-8444-444444444444" }, conversation: { id: "chat", conversationType: "groupChat", tenantId: config.tenantId }, value: { commandId: "recommendVisual", commandContext: "message", requestId: "r", messagePayload: { id: "m", body: { contentType: "html", content: "<p>Great work!</p>" }, from: { user: { displayName: "Private" } } } } };
describe("fetch task", () => {
  it("returns a deterministic URL dialog and stores only minimized context", () => {
    const store = new InvocationStore(); const log = new PrivacyLogger();
    const response = handleFetchTask(activity, config, store, log);
    const token = response.task.value.url.split("#token=")[1];
    expect(response.task.value.fallbackUrl).toBe(response.task.value.url);
    const claimed = store.claim(token);
    expect(claimed).toMatchObject({ selected: { mode: "selected", context: "Great work!" } });
    expect(JSON.stringify(claimed)).not.toContain("Private");
    expect(log.count("invoke_accepted")).toBe(1);
  });
  it("never reads compose drafts", () => {
    const store = new InvocationStore();
    const response = handleFetchTask({ ...activity, value: { ...activity.value, commandContext: "compose", draft: "secret draft", messagePayload: undefined } }, config, store, new PrivacyLogger());
    expect(store.claim(response.task.value.url.split("#token=")[1])?.selected).toEqual({ mode: "manual", context: "" });
  });
});
