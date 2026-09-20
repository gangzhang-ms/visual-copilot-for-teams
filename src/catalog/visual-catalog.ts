import type { PublicVisual } from "../shared/types";
export interface CatalogAsset {
  public: PublicVisual; tags: string[]; safe: boolean;
  rights: { version: string; approved: boolean; evidence: string; validFrom: number; validUntil: number; withdrawn: boolean;
    publicHosting: boolean; redistribution: boolean; transformations: boolean; poster: boolean; downstreamRecallRequired: boolean };
  rendition: { version: string; digest: string; rightsVersion: string; noticeVersion: string; verifiedAvailable: boolean; transformation: "original" | "derived" };
  original?: { version: string; url: string; digest: string; rightsVersion: string; verifiedAvailable: boolean };
}
// Pending originals live in assets/visual-review, never public or automatically eligible.
// Populate only after exact source/rendition/notices and distribution approval.
export const visualCatalog: readonly CatalogAsset[] = Object.freeze([]);
