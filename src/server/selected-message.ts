import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { NormalizedSelectedMessage } from "../shared/types";

type Payload = { body?: { contentType?: unknown; content?: unknown }; deleted?: unknown; attachments?: unknown };
const manual = (): NormalizedSelectedMessage => ({ mode: "manual", context: "" });
export function parseSelectedMessage(payload: unknown): NormalizedSelectedMessage {
  if (!payload || typeof payload !== "object") return manual();
  const value = payload as Payload;
  if (value.deleted === true || value.body && typeof value.body.content === "string" && value.body.content.length > 65_536) return manual();
  const attachments = Array.isArray(value.attachments) ? value.attachments.slice(0, 20) : [];
  if (!value.body || typeof value.body.content !== "string") return attachments.length ? { mode: "selected", context: "", attachmentNotice: "Selected attachments require authorized media access." } : manual();
  const type = String(value.body.contentType ?? "").toLowerCase();
  let context = "";
  if (type === "text") context = value.body.content;
  else if (type === "html") context = inertText(value.body.content);
  else return manual();
  context = context.replace(/\s+/gu, " ").trim();
  if (!context && !attachments.length && !/<img\b/i.test(value.body.content)) return manual();
  const attachmentNotice = attachments.length || /<img\b/i.test(value.body.content) ? "Selected visuals require authorized media access; unavailable assets are not analyzed." : undefined;
  return { mode: "selected", context, ...(attachmentNotice ? { attachmentNotice } : {}) };
}
export function inertText(html: string): string {
  const root = parseFragment(html);
  const visit = (node: DefaultTreeAdapterMap["node"]): string => {
    if ("nodeName" in node && ["script", "style", "template"].includes(node.nodeName)) return "";
    if ("value" in node && typeof node.value === "string") return node.value;
    return "childNodes" in node ? node.childNodes.map(visit).join(" ") : "";
  };
  return root.childNodes.map(visit).join(" ");
}
