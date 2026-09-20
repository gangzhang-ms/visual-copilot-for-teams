import { parentPort, workerData } from "node:worker_threads";
import sharp from "sharp";
import type { MediaLimits } from "./visual-config";
export interface DecodeInput { bytes: Uint8Array; limits: MediaLimits; metadataOnly?: boolean }
export async function decode(input: DecodeInput) {
  const { limits } = input;
  sharp.cache(false); sharp.concurrency(1);
  const source = Buffer.from(input.bytes);
  const image = sharp(source, { animated: true, limitInputPixels: Math.min(limits.maxPixels, 20_000_000), failOn: "warning" });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0, pageHeight = metadata.pageHeight ?? metadata.height ?? 0, pages = metadata.pages ?? 1;
  if (!["gif", "png", "jpeg"].includes(metadata.format ?? "") || !width || !pageHeight) throw new Error("unsupported-format");
  const pixels = width * pageHeight * pages;
  if (width * pageHeight > 20_000_000 || pages > limits.maxFrames || pixels > limits.maxPixels || pixels * 4 > limits.maxDecodedBytes) throw new Error("decoder-budget-exceeded");
  if (pages > 1 && (metadata.delay?.length !== pages || metadata.delay.some(d => !Number.isFinite(d) || d <= 0))) throw new Error("unsupported-format");
  const delays = Array.from({ length: pages }, (_, i) => metadata.delay?.[i] ?? 100);
  if (input.metadataOnly) return { width, height: pageHeight, pages, delays };
  // Decode every intermediate frame for disposal/compositing; cap total work before allocating raw pixels.
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (data.byteLength > limits.maxDecodedBytes || info.channels !== 4) throw new Error("decoder-budget-exceeded");
  return { data, width, height: pageHeight, pages, delays };
}
async function encode(input: { raw: Uint8Array; width: number; height: number; crop?: { left: number; top: number; width: number; height: number } }) {
  sharp.cache(false); sharp.concurrency(1);
  let frame = sharp(Buffer.from(input.raw), { raw: { width: input.width, height: input.height, channels: 4 } });
  if (input.crop) frame = frame.extract(input.crop);
  const { data, info } = await frame.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  if (data.length > 2 * 1024 * 1024) throw new Error("decoder-budget-exceeded");
  return { data, width: info.width, height: info.height };
}
if (parentPort && workerData) {
  (workerData.raw ? encode(workerData) : decode(workerData as DecodeInput)).then(value => parentPort!.postMessage({ ok: true, ...value, isolatedEnvironment:Object.keys(process.env).length===0 }))
    .catch(error => parentPort!.postMessage({ ok: false, code: ["unsupported-format", "decoder-budget-exceeded"].includes(error.message) ? error.message : "unsupported-format" }));
}
