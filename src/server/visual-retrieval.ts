import type { CatalogAsset } from "../catalog/visual-catalog";
import type { VisualCandidate } from "../shared/types";
import { requireVisual } from "./visual-errors";
export function eligible(asset: CatalogAsset, now = Date.now()) {
  const r = asset.rights, p = asset.public, rendition = asset.rendition;
  return asset.safe && r.approved && !!r.evidence && r.validFrom <= now && r.validUntil > now && !r.withdrawn
    && r.publicHosting && r.redistribution && !r.downstreamRecallRequired
    && !!rendition.digest && rendition.verifiedAvailable && rendition.rightsVersion === r.version && rendition.noticeVersion === p.notices.version
    && (rendition.transformation === "original" || rendition.transformation === "derived" && r.transformations)
    && !!p.version && !!p.id && !!p.alt && plain(p.alt, 300) && plain(p.notices.source) && plain(p.notices.creator) && plain(p.notices.license)
    && p.notices.text.length <= 8 && p.notices.text.every(t => plain(t, 500)) && p.notices.links.length <= 5
    && p.notices.links.every(l => plain(l.label, 100) && safePublicUrl(l.url))
    && (p.category === "emoji" ? !!p.unicode && p.unicode.length <= 32 && !p.imageUrl && !p.animationUrl : !p.unicode && !!p.imageUrl && safePublicUrl(p.imageUrl))
    && (p.category !== "gif" || !!p.animationUrl && r.poster && r.transformations && asset.original?.verifiedAvailable
      && !!asset.original.version && !!asset.original.digest && asset.original.url === p.animationUrl && asset.original.rightsVersion === r.version)
    && (!p.animationUrl || r.poster && r.transformations && safePublicUrl(p.animationUrl));
}
export function safePublicUrl(value: string) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && !u.port && /^[a-z][a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) && !u.hostname.endsWith(".local"); } catch { return false; }
}
export function plain(value: unknown, limit = 300): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/[<>\u0000-\u001f]/u.test(value);
}
export function retrieve(catalog: readonly CatalogAsset[], intent: string, now = Date.now(), permitted: typeof eligible = eligible) {
  const terms = intent.toLocaleLowerCase().split(/\s+/u);
  const pool = catalog.filter(a => permitted(a, now)).map(asset => ({ asset, score: asset.tags.filter(t => terms.some(term => t.toLocaleLowerCase().includes(term))).length }))
    .sort((a, b) => b.score - a.score || a.asset.public.id.localeCompare(b.asset.public.id)).slice(0, 12).map(x => x.asset);
  requireVisual(pool.length >= 6 && pool.some(a => a.public.category !== "emoji"), "insufficient-candidates");
  return pool;
}
export function validateRanking(value: unknown, pool: readonly CatalogAsset[], permitted: typeof eligible = eligible): [VisualCandidate, VisualCandidate, VisualCandidate] {
  requireVisual(Array.isArray(value) && value.length === 3, "model-output-invalid");
  const seen = new Set<string>();
  const result = value.map(item => {
    requireVisual(item && Object.keys(item).sort().join(",") === "caution,id,reason" && plain(item.reason, 700) && plain(item.caution, 500), "model-output-invalid");
    const asset = pool.find(a => a.public.id === item.id);
    requireVisual(asset && !seen.has(item.id) && permitted(asset), "asset-rights-unavailable"); seen.add(item.id);
    return { visual: structuredClone(asset.public), reason: item.reason, caution: item.caution };
  });
  requireVisual(result.some(c => c.visual.category !== "emoji"), "insufficient-candidates");
  return result as [VisualCandidate, VisualCandidate, VisualCandidate];
}
