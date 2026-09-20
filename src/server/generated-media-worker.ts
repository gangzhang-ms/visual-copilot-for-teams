import { parentPort, workerData } from "node:worker_threads";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { generationLimits as limits, requireGeneration } from "./local-generation-config";
sharp.cache(false); sharp.concurrency(1);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function singlePng(bytes: Buffer, side: number, cap: number) {
  requireGeneration(bytes.length <= cap && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "generation-invalid-png");
  let at = 8, ended = false;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at), type = bytes.subarray(at+4,at+8).toString("ascii");
    requireGeneration(length <= bytes.length - at - 12 && !["acTL","fcTL","fdAT"].includes(type), "generation-invalid-png");
    if (at === 8) requireGeneration(type === "IHDR" && length === 13 && bytes.readUInt32BE(at+8) === side && bytes.readUInt32BE(at+12) === side, "generation-dimensions");
    at += length + 12;
    if (type === "IEND") { requireGeneration(length === 0 && at === bytes.length, "generation-invalid-png"); ended = true; break; }
  }
  requireGeneration(ended, "generation-invalid-png");
}
async function png(bytes: Buffer, sourceSide: number, targetSide: number, cap: number) {
  singlePng(bytes, sourceSide, cap);
  const raw = await sharp(bytes, { limitInputPixels: limits.pixels, failOn: "warning" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  requireGeneration(raw.info.width === sourceSide && raw.info.height === sourceSide && raw.info.channels === 4 && raw.data.length === sourceSide * sourceSide * 4 && raw.data.length <= limits.raw, "generation-dimensions");
  const output = await sharp(raw.data, { raw: { width: sourceSide, height: sourceSide, channels: 4 } }).resize(targetSide, targetSide).png().toBuffer();
  requireGeneration(output.length <= (targetSide === 512 ? limits.png : limits.explain), "generation-output-too-large");
  return output;
}
async function gifFrames(bytes: Buffer, side: number) {
  requireGeneration(bytes.length <= limits.gif && ["GIF87a","GIF89a"].includes(bytes.subarray(0,6).toString("ascii")), "generation-invalid-gif");
  const metadata = await sharp(bytes, { animated: true, limitInputPixels: limits.framePixels }).metadata();
  requireGeneration(metadata.width === side && metadata.pageHeight === side && metadata.pages === 12 && metadata.delay?.length === 12
    && metadata.delay.every(n => n === 100) && metadata.loop === 0, "generation-invalid-gif");
  const raw = await sharp(bytes, { animated: true, limitInputPixels: limits.framePixels, failOn: "warning" }).ensureAlpha().raw().toBuffer();
  requireGeneration(raw.length === side * side * 4 * 12 && raw.length <= limits.stacked, "generation-invalid-gif");
  const frames = Array.from({ length: 12 }, (_, i) => raw.subarray(i*side*side*4, (i+1)*side*side*4));
  requireGeneration(new Set(frames.map(hash)).size >= 2, "generation-static-animation");
  return frames;
}
async function encodeGif(frames: Buffer[], side: number) {
  requireGeneration(frames.length === 12 && frames.every(f => f.length === side*side*4) && frames.length*side*side <= limits.framePixels, "generation-invalid-gif");
  // A fixed 125-color, white-matted palette prevents adaptive palettes changing the loop seam.
  for(const frame of frames)for(let i=0;i<frame.length;i+=4){
    const alpha=frame[i+3]/255;
    for(let channel=0;channel<3;channel++)frame[i+channel]=Math.round(Math.round((frame[i+channel]*alpha+255*(1-alpha))*4/255)*255/4);
    frame[i+3]=255;
  }
  const result = await sharp(Buffer.concat(frames), { raw: { width: side, height: side*12, channels: 4, pageHeight: side } })
    .gif({ colours: 128, effort: 1, dither: 0, interFrameMaxError: 0, interPaletteMaxError: 0, delay: Array(12).fill(100), loop: 0, keepDuplicateFrames: true }).toBuffer();
  requireGeneration(result.length <= (side === 512 ? limits.gif : limits.explain), "generation-output-too-large");
  await gifFrames(result, side); return result;
}
async function animate(bytes: Buffer) {
  singlePng(bytes, 512, limits.png);
  const frames: Buffer[] = [];
  for (let i=0; i<12; i++) {
    const side = 512 + Math.round(30 * (1 - Math.cos(2*Math.PI*i/11)) / 2);
    frames.push(await sharp(bytes, { limitInputPixels: limits.pixels, failOn: "warning" }).resize(side,side)
      .extract({ left: Math.floor((side-512)/2), top: Math.floor((side-512)/2), width: 512, height: 512 }).ensureAlpha().raw().toBuffer());
  }
  return encodeGif(frames, 512);
}
async function run() {
  const bytes = Buffer.from(workerData.bytes);
  requireGeneration(["canonicalize","animate","explain"].includes(workerData.operation) && Object.keys(workerData).every(k => ["operation","bytes","animated"].includes(k)), "generation-invalid-request");
  const started = performance.now(), cpu = process.cpuUsage(), rssStart = process.memoryUsage().rss;
  let image: Buffer | undefined, animation: Buffer | undefined, derivative: Buffer | undefined;
  if (workerData.operation === "canonicalize") image = await png(bytes,1024,512,limits.decoded);
  if (workerData.operation === "animate") animation = await animate(bytes);
  if (workerData.operation === "explain") {
    if (!workerData.animated) derivative = await png(bytes,512,128,limits.png);
    else {
      const frames = await gifFrames(bytes,512), small: Buffer[] = [];
      for (const frame of frames) small.push(await sharp(frame, { raw: { width:512, height:512, channels:4 } }).resize(128,128).raw().toBuffer());
      derivative = await encodeGif(small,128);
    }
  }
  parentPort!.postMessage({ ok: true, image, animation, derivative,
    diagnostics: { elapsedMs: performance.now()-started, cpuMicros: process.cpuUsage(cpu), rssStart, rssEnd: process.memoryUsage().rss, isolatedEnvironment: Object.keys(process.env).length === 0 } });
}
run().catch(() => parentPort!.postMessage({ ok: false, code: "generation-media-rejected" })).finally(() => parentPort!.close());
