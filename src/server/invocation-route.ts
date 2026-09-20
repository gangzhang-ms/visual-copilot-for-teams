import type { IHttpServerRequest, IHttpServerResponse } from "@microsoft/teams.apps";
import type { BotConfig } from "./config";
import type { InvocationStore } from "./invocation-store";
import type { PrivacyLogger } from "./privacy-logger";
import type { AnalysisSessions } from "./analysis-session";
export function claimInvocation(request: IHttpServerRequest, config: BotConfig, store: InvocationStore, log: PrivacyLogger, sessions?: AnalysisSessions): IHttpServerResponse {
  const origin = single(request.headers.origin);
  const fetchSite = single(request.headers["sec-fetch-site"]);
  const contentType = single(request.headers["content-type"]);
  if ((origin && origin !== config.publicOrigin) || !["same-origin", "same-site", undefined].includes(fetchSite) || contentType?.split(";")[0].trim().toLowerCase() !== "application/json") return rejected(log, 403);
  const token = request.body && typeof request.body === "object" ? (request.body as any).token : undefined;
  const envelope = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) && Object.keys(request.body as object).length === 1 ? store.claim(token) : undefined;
  if (!envelope) return rejected(log, 410);
  log.record("claim_succeeded");
  return { status: 200, body: { schemaVersion: 1, invocationId: envelope.binding.invocationId,
    selected: sessions ? { mode: envelope.selected.mode, context: "", attachmentNotice: "Sign in as the requesting user to view selected input." } : envelope.selected,
    ...(sessions ? { bootstrap: sessions.bootstrap(envelope.binding, envelope.selected), command: envelope.binding.commandId, teamsAppId: config.teamsAppId } : {}) } };
}
function rejected(log: PrivacyLogger, status: number) { log.record("claim_rejected"); return { status, body: { error: "Invocation unavailable." } }; }
function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
