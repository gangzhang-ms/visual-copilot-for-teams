import { createHash } from "node:crypto";
export function buildIdempotencyKey(parts: { tenantId: string; activityId: string; requestId: string; commandId: string; commandContext: string }) {
  return createHash("sha256").update([parts.tenantId, parts.activityId, parts.requestId, parts.commandId, parts.commandContext].join("\u001f")).digest("base64url");
}
