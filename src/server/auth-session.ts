import { ConfidentialClientApplication } from "@azure/msal-node";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { BotConfig } from "./config";
import type { VisualConfig } from "./visual-config";
import { visualReadiness } from "./visual-config";
import { AnalysisSessions, digest, opaque } from "./analysis-session";
import { requireVisual } from "./visual-errors";
import { boundedBody } from "./graph-context";
export interface AuthProvider {
  authorize(input: { state: string; nonce: string; challenge: string }): Promise<string>;
  redeem(code: string, verifier: string, nonce: string): Promise<{ tenant: string; user: string; token: string }>;
}
export async function verifyEntraIdentity(idToken: string, jwks: JWTVerifyGetKey,
  expected: { tenant: string; clientId: string; nonce: string }, now = new Date()) {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: `https://login.microsoftonline.com/${expected.tenant}/v2.0`,
    audience: expected.clientId, algorithms: ["RS256"], currentDate: now,
    requiredClaims: ["exp", "iat", "sub", "nonce", "tid", "oid"]
  });
  requireVisual(payload.nonce === expected.nonce && payload.tid === expected.tenant
    && typeof payload.oid === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(payload.oid)
    && typeof payload.sub === "string" && payload.sub.trim().length > 0
    && typeof payload.iat === "number" && Number.isFinite(payload.iat) && payload.iat >= 0
    && payload.iat <= Math.floor(now.getTime() / 1000) && payload.iat < payload.exp!, "permission-denied");
  return { tenant: payload.tid as string, user: payload.oid as string };
}
export function entraProvider(bot: BotConfig, config: VisualConfig): AuthProvider {
  requireVisual(visualReadiness(config).auth.ready, "not-configured");
  requireVisual(config.redirectUri === `${bot.publicOrigin}/api/auth/callback`, "not-configured");
  const authority = `https://login.microsoftonline.com/${bot.tenantId}`;
  const scopes = ["openid", "profile", "https://graph.microsoft.com/Chat.Read",
    "https://graph.microsoft.com/ChannelMessage.Read.All", "https://graph.microsoft.com/ChannelMember.Read.All",
    ...(config.fileReadsApproved ? ["https://graph.microsoft.com/Files.Read"] : [])];
  const jwks = createRemoteJWKSet(new URL(`${authority}/discovery/v2.0/keys`));
  // Per-transaction MSAL instances prevent durable refresh-token or cross-user caches.
  const client = () => new ConfidentialClientApplication({
    auth: { clientId: config.authClientId!, clientSecret: config.authSecret!, authority },
    system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => undefined } }
  });
  return {
    async authorize({ state, nonce, challenge }) {
      const url = new URL(await client().getAuthCodeUrl({ scopes, redirectUri: config.redirectUri!, state, nonce,
        codeChallenge: challenge, codeChallengeMethod: "S256", responseMode: "form_post" as any, prompt: "select_account" }));
      // MSAL adds offline_access by default; this application deliberately does not request it.
      url.searchParams.set("scope", url.searchParams.get("scope")!.split(" ").filter(s => s !== "offline_access").join(" "));
      return url.toString();
    },
    async redeem(code, verifier, nonce) {
      // MSAL's token request also adds offline_access. Use the standard code exchange
      // with explicit scopes, then JOSE signature/issuer/audience/nonce validation.
      const signal = AbortSignal.timeout(10_000);
      const response = await fetch(`${authority}/oauth2/v2.0/token`, { method: "POST", redirect: "error", signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.authClientId!, client_secret: config.authSecret!,
          redirect_uri: config.redirectUri!, code, code_verifier: verifier, scope: scopes.join(" ") }) });
      requireVisual(response.ok, "auth-required");
      const result = JSON.parse((await boundedBody(response, 64_000, signal)).toString("utf8"));
      requireVisual(typeof result.id_token === "string" && typeof result.access_token === "string", "auth-required");
      const identity = await verifyEntraIdentity(result.id_token, jwks, { tenant: bot.tenantId, clientId: config.authClientId!, nonce });
      return { ...identity, token: result.access_token };
    }
  };
}
export class AuthSessions {
  private transactions = new Map<string, { bootstrap: string; verifier: string; nonce: string; expiresAt: number }>();
  private completions = new Map<string, { bootstrap: string; session: string; expiresAt: number }>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private sessions: AnalysisSessions, private provider: () => AuthProvider, private now = () => Date.now()) {
    this.timer = setInterval(() => this.cleanup(), 30_000); this.timer.unref();
  }
  async start(bootstrap: string) {
    this.cleanup(); this.sessions.binding(bootstrap); requireVisual(this.transactions.size < 100, "busy");
    const state = opaque(), verifier = opaque(), nonce = opaque();
    this.transactions.set(digest(state), { bootstrap, verifier, nonce, expiresAt: this.now() + 300_000 });
    try { return await this.provider().authorize({ state, nonce, challenge: digest(verifier) }); }
    catch (e) { this.transactions.delete(digest(state)); throw e; }
  }
  async callback(state: string, code: string) {
    this.cleanup(); const t = this.transactions.get(digest(state)); requireVisual(t, "auth-required");
    this.transactions.delete(digest(state)); requireVisual(code.length > 0 && code.length < 8192, "auth-cancelled");
    const identity = await this.provider().redeem(code, t.verifier, t.nonce);
    requireVisual(t.expiresAt > this.now(), "expired");
    const session = this.sessions.authenticate(t.bootstrap, identity.tenant, identity.user, identity.token);
    const completion = opaque(); this.completions.set(digest(completion), { bootstrap: t.bootstrap, session, expiresAt: this.now() + 60_000 }); return completion;
  }
  finish(bootstrap: string, completion: string) {
    this.cleanup(); const c = this.completions.get(digest(completion));
    requireVisual(c && c.bootstrap === bootstrap, "permission-denied");
    this.completions.delete(digest(completion)); this.sessions.get(c.session); return c.session;
  }
  cleanup() {
    for (const [key, t] of this.transactions) if (t.expiresAt <= this.now()) this.transactions.delete(key);
    for (const [key, c] of this.completions) if (c.expiresAt <= this.now()) { this.sessions.close(c.session); this.completions.delete(key); }
  }
  dispose() { clearInterval(this.timer); for (const c of this.completions.values()) this.sessions.close(c.session); this.completions.clear(); this.transactions.clear(); }
}
