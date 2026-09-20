import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const root = resolve("assets", "chat-demo");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const scene = offset => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="380" height="301"><rect width="380" height="301" fill="#f4f7fa"/><rect x="35" y="40" width="100" height="100" fill="#168a83"/><circle cx="${230 + offset}" cy="160" r="45" fill="#d6a439"/><path d="M40 250h300" stroke="#203349" stroke-width="8"/></svg>`);
const names = ["film-reference.png", "gardener.png", "owl-motion.gif", "manifest.json", "reference-manifest.json"];
for (const name of names) {
  try {
    await access(resolve(root, name));
    throw new Error("Demo assets already exist; refusing to overwrite possible user media.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await mkdir(root, { recursive: true });
const source = scene(0);
const png = await sharp(source).png().toBuffer();
const frames = await Promise.all(Array.from({ length: 12 }, (_, index) => index * 3).map(async offset =>
  sharp(scene(offset)).resize(128, 128).ensureAlpha().raw().toBuffer()));
const gif = await sharp(Buffer.concat(frames), {
  raw: { width: 128, height: 1536, pageHeight: 128, channels: 4 }
}).gif({ delay: Array(12).fill(100), loop: 0 }).toBuffer();
const gardener = await sharp(source).resize(256, 256).png().toBuffer();
const entry = (name, bytes, width, height, frameCount) => ({
  name, bytes: bytes.length, sha256: hash(bytes), sourceSha256: hash(source),
  width, height, frames: frameCount
});
for (const [name, bytes] of [["film-reference.png", png], ["gardener.png", gardener], ["owl-motion.gif", gif]])
  await writeFile(resolve(root, name), bytes, { flag: "wx" });
const origin = "Synthetic geometric publication fixture; not a film frame or source-recognition acceptance";
await writeFile(resolve(root, "reference-manifest.json"), JSON.stringify({
  version: 1, origin, assets: [entry("film-reference.png", png, 380, 301, 1)]
}, null, 2) + "\n", { flag: "wx" });
await writeFile(resolve(root, "manifest.json"), JSON.stringify({
  version: 1, origin, assets: [entry("gardener.png", gardener, 256, 256, 1), entry("owl-motion.gif", gif, 128, 128, 12)]
}, null, 2) + "\n", { flag: "wx" });

await mkdir(resolve("teams"), { recursive: true });
for (const [name, size, background, stroke] of [
  ["color.png", 192, "#5b5fc7", "#ffffff"], ["outline.png", 32, "none", "#ffffff"]
]) {
  const icon = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 192 192"><rect width="192" height="192" fill="${background}"/><path d="M38 48h116v80H90l-30 24v-24H38z" fill="none" stroke="${stroke}" stroke-width="12" stroke-linejoin="round"/></svg>`);
  await writeFile(resolve("teams", name), await sharp(icon).png().toBuffer(), { flag: "wx" });
}
console.log("Created offline geometric test fixtures and original placeholder package icons. No external media or provider calls.");
