import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { CatalogAsset } from "../catalog/visual-catalog";
import { eligible } from "./visual-retrieval";
import { digest } from "./analysis-session";
export function catalogAssetReader(catalog: readonly CatalogAsset[], origin: string, root = resolve("dist/client/visuals")) {
  return async (path: string) => {
    const asset = catalog.find(a => (a.public.imageUrl === origin + path || a.public.animationUrl === origin + path) && eligible(a));
    if (!asset || !/^\/visuals\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|gif)$/.test(path)) return undefined;
    const original = asset.public.animationUrl === origin + path;
    if (original && !asset.original) return undefined;
    const file = resolve(root, path.slice("/visuals/".length));
    if (!file.startsWith(root + sep)) return undefined;
    try {
      if ((await stat(file)).size > (original ? 10 : 2) * 1024 * 1024) return undefined;
      const bytes = await readFile(file);
      if (digest(bytes) !== (original ? asset.original!.digest : asset.rendition.digest)) return undefined;
      return { bytes, mime: path.endsWith(".png") ? "image/png" : path.endsWith(".gif") ? "image/gif" : "image/jpeg" };
    } catch { return undefined; }
  };
}
