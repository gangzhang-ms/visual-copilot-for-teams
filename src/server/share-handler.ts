import type { CatalogAsset } from "../catalog/visual-catalog";
import type { InvocationBinding, SharePreviewDto } from "../shared/types";
import { type AnalysisSession, digest, opaque } from "./analysis-session";
import { eligible, plain } from "./visual-retrieval";
import { requireVisual } from "./visual-errors";
type ShareRecord = { session: AnalysisSession; version: number; shareVersion: number; candidateId: string; catalogDigest: string; dto: SharePreviewDto; consumedBy?: string };
export class ShareHandler {
  private records = new Map<string, ShareRecord>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private catalog: readonly CatalogAsset[], private enabled: boolean, private now = () => Date.now()) {
    this.timer = setInterval(() => this.cleanup(), 30_000); this.timer.unref();
  }
  prepare(session: AnalysisSession, candidateId: string, caption: string, destinationConfirmed: boolean) {
    this.cleanup();
    requireVisual(this.enabled && destinationConfirmed && session.binding.target && session.expiresAt > this.now(), "share-review-required");
    requireVisual(session.result?.status === "ready" && session.result.kind === "recommendations"
      && session.result.candidates.some(c => c.visual.id === candidateId), "share-review-required");
    requireVisual(typeof caption === "string" && caption.length <= 500 && (!caption || plain(caption, 500)), "share-review-required");
    const asset = this.catalog.find(a => a.public.id === candidateId);
    requireVisual(asset && eligible(asset, this.now()), "asset-rights-unavailable");
    const candidate = session.result.candidates.find(c => c.visual.id === candidateId)!;
    requireVisual(JSON.stringify(candidate.visual) === JSON.stringify(asset.public), "share-review-required");
    requireVisual(this.records.size < 200, "busy");
    const card = publicCard(asset, caption);
    requireVisual(Buffer.byteLength(JSON.stringify(card)) < 20_000, "attribution-unrenderable");
    const handle = opaque();
    const dto: SharePreviewDto = { handle, digest: digest(JSON.stringify(card)), card, visual: structuredClone(asset.public), caption,
      destination: session.binding.target.kind === "channel" ? "Bound standard channel — all channel members may see this" : "Bound chat — all chat members may see this",
      expiresAt: Math.min(session.expiresAt, this.now() + 120_000, asset.rights.validUntil) };
    session.shareVersion++;
    this.records.set(digest(handle), { session, version: session.version, shareVersion: session.shareVersion, candidateId, catalogDigest: digest(JSON.stringify(asset)), dto });
    return structuredClone(dto);
  }
  submit(handle: string, reviewedDigest: string, binding: InvocationBinding, requestId: string) {
    this.cleanup(); const record = this.records.get(digest(handle)); requireVisual(record, "expired");
    const { session, dto } = record;
    requireVisual(this.enabled && session.accessToken && !session.abort.signal.aborted && session.expiresAt > this.now() && session.version === record.version && session.shareVersion === record.shareVersion
      && session.binding.userId === binding.userId && session.binding.tenantId === binding.tenantId && session.binding.commandId === binding.commandId
      && JSON.stringify(session.binding.target) === JSON.stringify(binding.target) && reviewedDigest === dto.digest, "share-review-required");
    const asset = this.catalog.find(a => a.public.id === record.candidateId);
    requireVisual(asset && eligible(asset, this.now()) && digest(JSON.stringify(asset)) === record.catalogDigest, "asset-rights-unavailable");
    requireVisual(!record.consumedBy || record.consumedBy === requestId, "share-review-required");
    record.consumedBy = requestId;
    return { composeExtension: { type: "result" as const, attachmentLayout: "list" as const, attachments: [structuredClone(dto.card)] } };
  }
  cleanup() { for (const [key, r] of this.records) if (r.dto.expiresAt <= this.now() || !r.session.accessToken || r.session.version !== r.version || r.session.shareVersion !== r.shareVersion) this.records.delete(key); }
  dispose() { clearInterval(this.timer); this.records.clear(); }
}
export function publicCard(asset: CatalogAsset, caption: string) {
  const p = asset.public;
  const notices = [p.notices.source, p.notices.creator, p.notices.license, ...p.notices.text, ...p.notices.links.map(l => `${l.label}: ${l.url}`)].join("\n\n");
  const text = [caption, notices].filter(Boolean).join("\n\n");
  return {
    contentType: "application/vnd.microsoft.card.adaptive",
    content: { type: "AdaptiveCard", version: "1.4", body: [
      ...(p.unicode ? [{ type: "TextBlock", text: p.unicode, wrap: true }] : [{ type: "Image", url: p.imageUrl, altText: p.alt }]),
      { type: "TextBlock", text: p.alt, wrap: true },
      ...(caption ? [{ type: "TextBlock", text: caption, wrap: true }] : []),
      { type: "TextBlock", text: notices, wrap: true },
      ...(p.animationUrl ? [{ type: "TextBlock", text: `Approved animation: ${p.animationUrl}`, wrap: true }] : [])
    ] },
    preview: { contentType: "application/vnd.microsoft.card.thumbnail", content: {
      title: p.alt, text: `${p.unicode ?? ""}\n${text}${p.animationUrl ? `\nApproved animation: ${p.animationUrl}` : ""}`,
      ...(p.imageUrl ? { images: [{ url: p.imageUrl, alt: p.alt }] } : {})
    } }
  };
}
