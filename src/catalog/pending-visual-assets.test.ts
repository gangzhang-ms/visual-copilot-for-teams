import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { expect, it } from "vitest";
import { visualCatalog } from "./visual-catalog";
const root = resolve("assets/visual-review/v1");
it("stages eight distinct original non-emoji concepts without approving or publishing them", async () => {
  const inventory = JSON.parse(await readFile(resolve(root, "inventory.json"), "utf8"));
  expect(inventory.status).toBe("pending-owner-review");
  expect(inventory.assets).toHaveLength(8);
  expect(new Set(inventory.assets.map((a: any) => a.id)).size).toBe(8);
  expect(inventory.assets.filter((a: any) => a.category === "gif")).toHaveLength(2);
  expect(visualCatalog).toEqual([]);
  for (const asset of inventory.assets) {
    expect(asset.rights.approved).toBe(false);
    expect(asset.rights.publicHosting).toBe(false);
    expect(asset.rights.redistribution).toBe(false);
    expect(asset.contentReview).toBe("pending");
    expect(asset.proposedNotices.license).toContain("NOT APPROVED");
    expect(asset.publicUrl).toBeNull();
    expect(asset.artifacts.some((a: any) => a.role === (asset.category === "gif" ? "poster" : "rendition"))).toBe(true);
    for (const artifact of asset.artifacts) {
      const path = resolve(root, artifact.file);
      expect(path.startsWith(root + sep)).toBe(true);
      const bytes = await readFile(path);
      expect(bytes.byteLength).toBe(artifact.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
      expect(createHash("sha256").update(bytes).digest("base64url")).toBe(artifact.sha256Base64url);
    }
  }
});
