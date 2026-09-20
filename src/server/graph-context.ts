import type { ContextPreview, VisualTarget } from "../shared/types";
import type { AnalysisSession } from "./analysis-session";
import { digest } from "./analysis-session";
import type { VisualConfig } from "./visual-config";
import { inertText } from "./selected-message";
import { requireVisual, VisualError } from "./visual-errors";
export type Transport = typeof fetch;
export const segment = (s: string) => encodeURIComponent(s);
export function targetBase(target: VisualTarget | undefined) {
  requireVisual(target, "target-unavailable");
  if (target.kind === "chat") return `/chats/${segment(target.conversationId)}`;
  requireVisual(/^[a-f\d-]{36}$/i.test(target.teamId), "target-unavailable");
  return `/teams/${segment(target.teamId)}/channels/${segment(target.channelId)}`;
}
export function selectedPath(target: VisualTarget | undefined) {
  requireVisual(target?.selectedId, "target-unavailable");
  const base = `${targetBase(target)}/messages`;
  if (target.kind === "channel") {
    requireVisual(target.rootId, "target-unavailable");
    return `${base}/${segment(target.rootId)}${target.rootId === target.selectedId ? "" : `/replies/${segment(target.selectedId)}`}`;
  }
  return `${base}/${segment(target.selectedId)}`;
}
export async function boundedBody(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  requireVisual(!signal.aborted, "cancelled");
  requireVisual(Number(response.headers.get("content-length") ?? 0) <= limit, "request-byte-budget-exceeded");
  const reader = response.body?.getReader(); requireVisual(reader, "media-unavailable");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      requireVisual(!signal.aborted, "cancelled");
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; requireVisual(size <= limit, "request-byte-budget-exceeded"); chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export class GraphContext {
  constructor(private config: VisualConfig, private transport: Transport = fetch) {}
  async read(session: AnalysisSession, path: string, consent: boolean, operationSignal?: AbortSignal): Promise<any> {
    requireVisual(consent && this.config.graphVerified && !!session.accessToken, "permission-denied");
    const base = targetBase(session.binding.target);
    requireVisual(path.startsWith(base + "/") && !path.includes("#") && !path.includes(".."), "target-unavailable");
    const signal = AbortSignal.any([session.abort.signal, AbortSignal.timeout(10_000), ...(operationSignal ? [operationSignal] : [])]);
    const response = await this.transport(`https://graph.microsoft.com/v1.0${path}`, {
      method: "GET", headers: { Authorization: `Bearer ${session.accessToken}` }, redirect: "error", signal
    });
    if (response.status === 401 || response.status === 403) throw new VisualError("permission-denied");
    requireVisual(response.ok, "target-unavailable");
    try { return JSON.parse((await boundedBody(response, 256_000, signal)).toString("utf8")); }
    catch (error) { if (error instanceof VisualError) throw error; throw new VisualError("target-unavailable"); }
  }
  async load(session: AnalysisSession, consent: boolean): Promise<ContextPreview> {
    const target = session.binding.target; requireVisual(target, "target-unavailable");
    const messages: { path: string; value: any }[] = [];
    if (target.selectedId) {
      const path = selectedPath(target); messages.push({ path, value: await this.read(session, path, consent) });
    }
    let listPath = `${targetBase(target)}/messages?$top=12&$orderby=createdDateTime%20desc`;
    if (target.kind === "channel") {
      requireVisual(target.rootId, "target-unavailable");
      const root = `${targetBase(target)}/messages/${segment(target.rootId)}`;
      if (target.rootId !== target.selectedId) messages.push({ path: root, value: await this.read(session, root, consent) });
      listPath = `${root}/replies?$top=12`;
    } else if (messages[0]) {
      const time = messages[0].value.createdDateTime;
      requireVisual(typeof time === "string" && Number.isFinite(Date.parse(time)), "target-unavailable");
      listPath += `&$filter=${encodeURIComponent(`createdDateTime lt ${new Date(time).toISOString()}`)}`;
    }
    const page = await this.read(session, listPath, consent);
    requireVisual(Array.isArray(page.value), "target-unavailable");
    const known = new Set(messages.map(m => m.value.id));
    let partial = !!page["@odata.nextLink"];
    for (const value of page.value.slice(0, 13)) {
      if (known.has(value.id)) continue;
      if (messages.length >= 12) { partial = true; break; }
      requireVisual(typeof value.id === "string", "target-unavailable"); known.add(value.id);
      const path = target.kind === "chat" ? `${targetBase(target)}/messages/${segment(value.id)}` : `${targetBase(target)}/messages/${segment(target.rootId!)}/replies/${segment(value.id)}`;
      messages.push({ path, value });
    }
    let total = 0; session.sources.clear();
    const snippets = messages.map(({ path, value }, index) => {
      requireVisual(!value.deletedDateTime && value.body && typeof value.body.content === "string", "target-unavailable");
      const text = minimize(value.body.contentType === "html" ? inertText(value.body.content) : value.body.content);
      const bounded = text.slice(0, Math.max(0, 20_000 - total)); total += bounded.length; if (bounded.length !== text.length) partial = true;
      session.sources.set(path, messageVersion(value));
      return { label: `Context ${index + 1}`, text: bounded, timestamp: String(value.createdDateTime ?? ""), included: total <= 8_000 };
    });
    return { snippets, partial, provenance: target.kind === "channel" ? "channel-thread" : "preceding-window", retrievedAt: Date.now() };
  }
  async revalidate(session: AnalysisSession, signal?: AbortSignal) {
    for (const [path, version] of session.sources) {
      const value = await this.read(session, path, true, signal);
      requireVisual(!value.deletedDateTime && messageVersion(value) === version, "processing-review-required");
    }
  }
}
export function messageVersion(value: any) { return digest(JSON.stringify([value.id, value.lastModifiedDateTime, value.deletedDateTime, value.body, value.attachments])); }
function minimize(text: string) {
  return text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[address removed]").replace(/<at\b[^>]*>.*?<\/at>/gi, "[participant]").replace(/\s+/gu, " ").trim();
}
