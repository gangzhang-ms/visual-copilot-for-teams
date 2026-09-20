import type { BotConfig } from "./config";
import { HttpError } from "./errors";
import type { VisualCommand, VisualTarget } from "../shared/types";
export type AuthorizedInvoke = {
  activityId: string; requestId: string; invocationId: string;
  tenantId: string; userId: string; commandId: VisualCommand; target: VisualTarget;
  commandContext: "compose" | "message"; messagePayload?: unknown;
};
export function authorizeInvoke(activity: unknown, config: BotConfig): AuthorizedInvoke {
  if (!activity || typeof activity !== "object") throw new HttpError(400);
  const value = activity as Record<string, any>;
  if (!["composeExtension/fetchTask", "composeExtension/submitAction"].includes(value.name) || value.channelId !== "msteams") throw new HttpError(400);
  if (value.recipient?.id !== config.clientId) throw new HttpError(403);
  const tenantId = value.conversation?.tenantId ?? value.channelData?.tenant?.id;
  if (tenantId !== config.tenantId || value.channelData?.tenant?.id && value.channelData.tenant.id !== config.tenantId) throw new HttpError(403);
  const serviceUrl = typeof value.serviceUrl === "string" ? new URL(value.serviceUrl) : undefined;
  if (!serviceUrl || serviceUrl.protocol !== "https:" || serviceUrl.hostname !== "smba.trafficmanager.net" || serviceUrl.username || serviceUrl.password || serviceUrl.port || serviceUrl.hash) throw new HttpError(403);
  if (!["explainVisual", "recommendVisual"].includes(value.value?.commandId) || !["compose", "message"].includes(value.value?.commandContext)) throw new HttpError(400);
  if (value.value.commandId === "explainVisual" && value.value.commandContext !== "message") throw new HttpError(400);
  const activityId = stringField(value.id);
  const requestId = stringField(value.value?.requestId ?? value.value?.request?.id ?? value.id);
  const userId = stringField(value.from?.aadObjectId);
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(userId)) throw new HttpError(403);
  const conversationId = stringField(value.conversation?.id);
  const payload = value.value.messagePayload;
  const selectedId = value.value.commandContext === "message" ? stringField(payload?.id) : undefined;
  let target: VisualTarget;
  if (value.channelData?.channel?.id) {
    const teamId = stringField(value.channelData?.team?.aadGroupId);
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(teamId) || value.channelData.channel.membershipType && value.channelData.channel.membershipType !== "standard") throw new HttpError(403);
    target = { kind: "channel", conversationId, teamId, channelId: stringField(value.channelData.channel.id),
      ...(selectedId ? { selectedId, rootId: stringField(payload?.replyToId ?? selectedId) } : {}) };
  } else {
    if (!["personal", "groupChat"].includes(value.conversation?.conversationType)) throw new HttpError(403);
    target = { kind: "chat", conversationId, ...(selectedId ? { selectedId } : {}) };
  }
  return { activityId, requestId, invocationId: activityId, tenantId, userId, target, commandId: value.value.commandId, commandContext: value.value.commandContext, ...(value.value.commandContext === "message" ? { messagePayload: payload } : {}) };
}
function stringField(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 256) throw new HttpError(400);
  return value;
}
