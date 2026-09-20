import type { BotConfig } from "./config";
import type { NativeHttpAdapter } from "./native-http-adapter";
import { AuthSessions } from "./auth-session";
import { requireVisual, failure } from "./visual-errors";
import type { IHttpServerRequest } from "@microsoft/teams.apps";
export function sameOrigin(request: IHttpServerRequest, config: BotConfig) {
  const origin = request.headers.origin;
  requireVisual(origin === config.publicOrigin && ["same-origin", undefined].includes(request.headers["sec-fetch-site"] as string | undefined), "permission-denied");
}
const page = (completion = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Visual Copilot for Teams sign in</title></head><body><main id="auth" data-completion="${completion}">Signing in…</main><script src="/auth-bootstrap.js"></script></body></html>`;
export function registerAuthRoutes(adapter: NativeHttpAdapter, config: BotConfig, auth: AuthSessions) {
  adapter.registerPage("/auth/start", () => page());
  adapter.registerPage("/auth-bootstrap.js", () => `(function(){var m=/^#bootstrap=([A-Za-z0-9_-]{43})$/.exec(location.hash);history.replaceState(null,"",location.pathname);var h=m?m[1]:"";import("/assets/auth-entry.js").then(function(x){x.start(h);});})();`);
  adapter.registerRoute("POST", "/api/auth/start", async request => {
    const body = request.body as Record<string, unknown> | undefined;
    try { sameOrigin(request, config); requireVisual(typeof body?.bootstrap === "string", "auth-required"); return { status: 200, body: { url: await auth.start(body.bootstrap) } }; }
    catch (error) { return { status: 403, body: failure(error) }; }
  });
  adapter.registerForm("/api/auth/callback", async request => {
    const body = request.body as Record<string, unknown> | undefined;
    try { requireVisual(typeof body?.state === "string" && typeof body?.code === "string", "auth-cancelled");
      return { status: 200, body: page(await auth.callback(body.state, body.code)) }; }
    catch { return { status: 400, body: page() }; }
  });
  adapter.registerRoute("POST", "/api/auth/finish", async request => {
    const body = request.body as Record<string, unknown> | undefined;
    try { sameOrigin(request, config); requireVisual(typeof body?.bootstrap === "string" && typeof body?.completion === "string", "auth-required");
      return { status: 200, body: { capability: auth.finish(body.bootstrap, body.completion) } }; }
    catch (error) { return { status: 403, body: failure(error) }; }
  });
}
