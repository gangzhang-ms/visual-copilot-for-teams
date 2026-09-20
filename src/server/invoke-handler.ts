import type { BotConfig } from "./config";
import { authorizeInvoke } from "./activity-authorization";
import { buildIdempotencyKey } from "./idempotency";
import { InvocationStore } from "./invocation-store";
import { PrivacyLogger } from "./privacy-logger";
import { parseSelectedMessage } from "./selected-message";
export function handleFetchTask(activity: unknown, config: BotConfig, store: InvocationStore, log: PrivacyLogger) {
  try {
    if ((activity as any)?.name !== "composeExtension/fetchTask") throw new Error("Invalid fetch");
    const invoke = authorizeInvoke(activity, config);
    const selected = invoke.commandContext === "message" ? parseSelectedMessage(invoke.messagePayload) : { mode: "manual" as const, context: "" };
    const idempotencyKey = buildIdempotencyKey({ tenantId: invoke.tenantId, activityId: invoke.activityId, requestId: invoke.requestId, commandId: invoke.commandId, commandContext: invoke.commandContext });
    const token = store.createOrGet(idempotencyKey, {
      binding: { tenantId: invoke.tenantId, userId: invoke.userId, commandId: invoke.commandId, commandContext: invoke.commandContext, invocationId: invoke.invocationId, target: invoke.target },
      selected
    });
    const url = `${config.publicOrigin}/dialog#token=${token}`;
    log.record("invoke_accepted");
    return { task: { type: "continue" as const, value: { title: "Visual Copilot for Teams", width: 680, height: 720, url, fallbackUrl: url } } };
  } catch (error) {
    log.record("invoke_rejected");
    throw error;
  }
}
