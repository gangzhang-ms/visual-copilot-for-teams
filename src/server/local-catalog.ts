import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute } from "node:path";
import inventory from "../../assets/visual-review/v1/inventory.json";
import type { CatalogAsset } from "../catalog/visual-catalog";
import type { LocalCatalogReview } from "../shared/local-chat";
import type { PublicVisual } from "../shared/types";
import { digest } from "./analysis-session";
import { requireVisual } from "./visual-errors";

export async function loadLocalCatalog(directPersonal=false) {
  const root = resolve("assets", "visual-review", "v1");
  const files = new Map<string, { bytes: Buffer; mime: string }>();
  const assets: CatalogAsset[] = [], review: LocalCatalogReview["assets"] = [];
  for (const item of inventory.assets) {
    for (const artifact of item.artifacts) {
      const path = resolve(root, artifact.file), child = relative(root, path);
      requireVisual(!child.startsWith("..") && !isAbsolute(child), "asset-rights-unavailable");
      const bytes = await readFile(path);
      requireVisual(bytes.length === artifact.bytes && createHash("sha256").update(bytes).digest("hex") === artifact.sha256, "asset-rights-unavailable");
      files.set(artifact.file, { bytes, mime: artifact.mime });
    }
    const still = item.artifacts.find(a => a.role === "rendition" || a.role === "poster")!;
    const animation = item.artifacts.find(a => a.role === "original-animation");
    const category = item.category;
    requireVisual(still && (category === "image" || category === "sticker" || category === "gif"), "asset-rights-unavailable");
    const visual: PublicVisual = { id: item.id, version: item.version, category,
      alt: item.alt, imageUrl: `/local/assets/${item.id}/still`, ...(animation ? { animationUrl: `/local/assets/${item.id}/animation` } : {}),
      notices: { ...item.proposedNotices, text: [...item.proposedNotices.text, directPersonal
        ?"User-authorized personal local test inventory. Not corporate rights approval or public redistribution permission."
        :"Session-only local test use requires your permission attestation. Not production rights approval."] } };
    assets.push({ public: visual, tags: item.tags, safe: false,
      rights: { version: "pending-v1", approved: false, evidence: "", validFrom: 0, validUntil: 0, withdrawn: false,
        publicHosting: false, redistribution: false, transformations: false, poster: false, downstreamRecallRequired: false },
      rendition: { version: item.version, digest: still.sha256Base64url, rightsVersion: "pending-v1",
        noticeVersion: visual.notices.version, verifiedAvailable: true, transformation: "derived" } });
    review.push({ visual, provenance: `${item.provenance.method} ${item.provenance.legalOwnership}`,
      hashes: item.artifacts.map(a => ({ file: a.file, sha256: a.sha256 })) });
  }
  const inventoryDigest = digest(JSON.stringify(review));
  return {
    assets, review, digest: inventoryDigest,
    read(id: string, role: string) {
      const item = inventory.assets.find(a => a.id === id);
      const artifact = item?.artifacts.find(a => role === "still" ? a.role === "rendition" || a.role === "poster" : role === "animation" && a.role === "original-animation");
      return artifact ? files.get(artifact.file) : undefined;
    },
    permits(asset: CatalogAsset, attestation: string | undefined) {
      const original = assets.find(a => a.public.id === asset.public.id);
      return attestation === inventoryDigest && !!original && JSON.stringify(original) === JSON.stringify(asset);
    }
  };
}
