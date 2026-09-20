import { expect, it, vi } from "vitest";
import { createServerApp } from "./app";
import { loadBotConfig } from "./config";
it("keeps auth form exception narrow and protects readiness/private routes by origin and session", async () => {
  const config = loadBotConfig({ NODE_ENV: "test", TEST_ONLY_BYPASS_CONNECTOR_AUTH: "true", TEAMS_APP_ID: "11111111-1111-4111-8111-111111111111",
    CLIENT_ID: "22222222-2222-4222-8222-222222222222", TENANT_ID: "33333333-3333-4333-8333-333333333333",
    CLIENT_SECRET: "protected-development-secret", PUBLIC_ORIGIN: "https://synthetic.example.test" });
  const server = createServerApp(config);
  await server.app.start("0");
  await vi.waitFor(() => expect(server.adapter.listeningPort).toBeTypeOf("number"));
  const base = `http://127.0.0.1:${server.adapter.listeningPort}`;
  try {
    const bootstrap = server.visual.sessions.bootstrap({ invocationId: "i", tenantId: config.tenantId, userId: "u", commandId: "recommendVisual", commandContext: "compose" });
    const capability = server.visual.sessions.authenticate(bootstrap, config.tenantId, "u", "PRIVATE_SENTINEL");
    const request = (path: string, origin = config.publicOrigin, auth = capability) => fetch(base + path, { method: "POST", headers: { Origin: origin,
      "Content-Type": "application/json", Authorization: `Bearer ${auth}` }, body: "{}" });
    expect((await request("/api/readiness", "https://wrong.test")).status).toBe(400);
    expect((await request("/api/readiness", config.publicOrigin, "wrong")).status).toBe(400);
    const response = await request("/api/readiness");
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    const readiness = await response.text(); expect(readiness).not.toContain("PRIVATE_SENTINEL");
    expect(Object.values(JSON.parse(readiness)).every((v: any) => !v.ready)).toBe(true);
    expect((await fetch(base + "/api/context", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "consent=true" })).status).toBe(415);
    const callback = await fetch(base + "/api/auth/callback", { method: "POST", headers: { Origin: "https://login.microsoftonline.com", "Content-Type": "application/x-www-form-urlencoded" }, body: "state=unknown&code=synthetic" });
    expect(callback.status).toBe(400); expect(callback.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await fetch(base + "/api/auth/callback?code=must-not-log")).status).toBe(400);
    expect((await request("/api/session/close")).status).toBe(200);
    expect((await request("/api/readiness")).status).toBe(400);
  } finally { server.visual.dispose(); await server.app.stop(); }
});
