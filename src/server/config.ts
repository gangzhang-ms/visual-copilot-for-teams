export interface BotConfig {
  teamsAppId: string; clientId: string; tenantId: string; clientSecret: string;
  publicOrigin: string; port: number; testAuthBypass: boolean; standaloneHarness: boolean;
}
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const placeholder = /(replace|placeholder|example|secret-reference|00000000)/i;
export function loadBotConfig(env: Record<string, string | undefined>): Readonly<BotConfig> {
  const testAuthBypass = env.NODE_ENV === "test" && env.TEST_ONLY_BYPASS_CONNECTOR_AUTH === "true";
  if ((env.SKIP_AUTH || env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS) && !testAuthBypass) throw new Error("Authentication bypass is forbidden.");
  const values = { teamsAppId: env.TEAMS_APP_ID ?? "", clientId: env.CLIENT_ID ?? env.BOT_APP_ID ?? "", tenantId: env.TENANT_ID ?? env.ALLOWED_TENANT_ID ?? "", clientSecret: env.CLIENT_SECRET ?? "", publicOrigin: env.PUBLIC_ORIGIN ?? "" };
  if (env.BOT_APP_ID && env.CLIENT_ID && env.BOT_APP_ID !== env.CLIENT_ID) throw new Error("Bot ID mismatch.");
  if (env.ALLOWED_TENANT_ID && env.TENANT_ID && env.ALLOWED_TENANT_ID !== env.TENANT_ID) throw new Error("Tenant ID mismatch.");
  if (![values.teamsAppId, values.clientId, values.tenantId].every((value) => guid.test(value) && !placeholder.test(value))) throw new Error("Valid distinct IDs are required.");
  if (values.teamsAppId === values.clientId) throw new Error("Teams App ID and Bot App ID must be distinct.");
  const origin = new URL(values.publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== values.publicOrigin || origin.hostname.includes("*")) throw new Error("PUBLIC_ORIGIN must be one bare HTTPS origin.");
  if (!testAuthBypass && (!values.clientSecret || placeholder.test(values.clientSecret) || values.clientSecret.length < 16)) throw new Error("A protected server client secret is required.");
  const standaloneHarness = env.NODE_ENV !== "production" && env.ENABLE_STANDALONE_HARNESS === "true";
  return Object.freeze({ ...values, port: Number(env.PORT ?? 3978), testAuthBypass, standaloneHarness });
}
