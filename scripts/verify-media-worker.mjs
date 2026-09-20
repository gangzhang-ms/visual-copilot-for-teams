import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import sharp from "sharp";
import { builtUrl } from "./build-root.mjs";
const { normalizeMedia } = await import(builtUrl("media-normalizer.js"));
import { boundaryGif, rgba } from "./gif-boundary-fixtures.mjs";
const limits = { verified: true, maxFrames: 12, maxPixels: 1000, maxDecodedBytes: 4000, timeoutMs: 3000, memoryMb: 64 };
const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255], [0, 255, 255, 255], [255, 0, 255, 255]];
const raw = Buffer.from(colors.flatMap(color => Array.from({ length: 4 }, () => color).flat()));
const gif = await sharp(raw, { raw: { width: 2, height: 12, pageHeight: 2, channels: 4 } }).gif({ delay: [100, 100, 100, 100, 100, 100], loop: 0, effort: 1 }).toBuffer();
async function run(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(builtUrl("media-worker.js")), { env: {}, workerData, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error("Bounded worker timed out")); }, 5000);
    worker.once("message", value => { clearTimeout(timeout); void worker.terminate(); resolve(value); });
    worker.once("error", error => { clearTimeout(timeout); void worker.terminate(); reject(error); });
  });
}
const decoded = await run({ bytes: gif, limits });
assert.equal(decoded.ok, true); assert.equal(decoded.pages, 6);
assert.deepEqual(decoded.delays, [100, 100, 100, 100, 100, 100]);
assert.deepEqual(Buffer.from(decoded.data), raw);
const denied = await run({ bytes: gif, limits: { ...limits, maxFrames: 2 } });
assert.equal(denied.ok, false); assert.equal(denied.code, "decoder-budget-exceeded");
const normalized = await run({ raw: raw.subarray(0, 16), width: 2, height: 2 });
assert.equal(normalized.ok, true); assert.equal(normalized.width, 2);
assert.equal((await sharp(Buffer.from(normalized.data)).metadata()).format, "png");
const profile = { version: "SYNTHETIC", endpoint: "https://synthetic.openai.azure.com/", deployment: "synthetic", modelVersion: "synthetic", apiVersion: "synthetic",
  validUntil: Date.now() + 600_000, evidence: "TEST ONLY", verified: true, imageCap: 10, requestBytes: 12_000_000, inputTokens: 12_000, outputTokens: 2000, contextTokens: 16_000,
  imageTokenUpperBound: 100, accounting: "utf8-upper-bound", completionField: "max_tokens" };
const pipelineLimits = { ...limits, timeoutMs: 15_000 };
const source = { id: "synthetic-gif", bytes: gif, mime: "image/gif", category: "gif" };
const two = await normalizeMedia([source, { ...source, id: "synthetic-gif-2" }], profile, pipelineLimits, new AbortController().signal);
assert.equal(two.samples.length, 10); assert.equal(two.samples.filter(s => s.assetId === source.id).length, 5);
const lower = await normalizeMedia([source, { ...source, id: "synthetic-gif-2" }], { ...profile, imageCap: 5 }, pipelineLimits, new AbortController().signal);
assert.equal(lower.samples.length, 5); assert.equal(lower.samples.filter(s => s.assetId === source.id).length, 3);
await assert.rejects(() => normalizeMedia([source, source], { ...profile, imageCap: 3 }, pipelineLimits, new AbortController().signal), /image-budget-exceeded/);
for (const category of ["image", "screenshot", "meme", "sticker"]) {
  const result = await normalizeMedia([{ id: "synthetic-still", bytes: Buffer.from(normalized.data), mime: "image/png", category }], profile, pipelineLimits, new AbortController().signal);
  assert.equal(result.samples.length, 1); assert.equal(result.coverage[0].category, category);
}
for (const [disposal, expected] of [[1, [1, 2, 3]], [2, [1, 0, 3]], [3, [1, 1, 3]]]) {
  const fixture = boundaryGif([{ pixels: [1, 1, 1] }, { pixels: [2], left: 1, disposal }, { pixels: [3], left: 2 }]);
  const composited = await run({ bytes: fixture, limits });
  assert.equal(composited.ok, true); assert.equal(composited.pages, 3);
  assert.deepEqual(Buffer.from(composited.data), rgba([1, 1, 1, 1, 2, 1, ...expected]), `disposal ${disposal}`);
}
const transparent = await run({ bytes: boundaryGif([{ pixels: [1, 1, 1] }, { pixels: [0, 2] }]), limits });
assert.equal(transparent.ok, true); assert.deepEqual(Buffer.from(transparent.data), rgba([1, 1, 1, 1, 2, 1]));
const unknownDuration = await run({ bytes: boundaryGif([{ pixels: [1, 1, 1], delay: 0 }, { pixels: [2, 2, 2] }]), limits });
assert.equal(unknownDuration.ok, false); assert.equal(unknownDuration.code, "unsupported-format");
const transientBytes = boundaryGif([{ pixels: [1, 1, 1] }, { pixels: [2, 2, 2], delay: 2 }, { pixels: [1, 1, 1] }]);
const transient = { id: "transient", bytes: transientBytes, mime: "image/gif", category: "gif" };
const missed = await normalizeMedia([transient], { ...profile, imageCap: 2 }, pipelineLimits, new AbortController().signal);
assert.deepEqual(missed.samples.map(s => s.frameIndex), [0, 2]);
assert.equal(missed.coverage[0].durationMs, 220); assert.equal(missed.coverage[0].omitted, true);
assert.match(missed.coverage[0].limitation, /intervening content.*may be missed/);
const focused = await normalizeMedia([{ ...transient, window: [90, 130] }], profile, pipelineLimits, new AbortController().signal);
assert.deepEqual(focused.samples.map(s => [s.frameIndex, s.timestampMs]), [[0, 0], [1, 100], [2, 120]]);
assert.deepEqual(await sharp(Buffer.from(focused.samples[1].dataUrl.split(",")[1], "base64")).ensureAlpha().raw().toBuffer(), rgba([2, 2, 2]));
await assert.rejects(() => normalizeMedia([{ ...transient, window: [100, 120] }], profile, pipelineLimits, new AbortController().signal), /processing-review-required/);
await assert.rejects(() => normalizeMedia([{ ...transient, window: [0, 221] }], profile, pipelineLimits, new AbortController().signal), /decoder-budget-exceeded/);
const exact = { ...pipelineLimits, maxFrames: 3, maxPixels: 9, maxDecodedBytes: 36 };
assert.equal((await normalizeMedia([transient], profile, exact, new AbortController().signal)).samples.length, 3);
for (const limit of [{ ...exact, maxFrames: 2 }, { ...exact, maxPixels: 8 }, { ...exact, maxDecodedBytes: 35 }]) {
  await assert.rejects(() => normalizeMedia([transient], profile, limit, new AbortController().signal), /decoder-budget-exceeded|unsupported-format/);
}
await assert.rejects(() => normalizeMedia([transient, transient], profile, exact, new AbortController().signal), /decoder-budget-exceeded/);
await assert.rejects(() => normalizeMedia([transient], profile, pipelineLimits, AbortSignal.abort()), /cancelled/);
await assert.rejects(() => normalizeMedia([transient], profile, { ...pipelineLimits, timeoutMs: 1 }, new AbortController().signal), /decoder-budget-exceeded/);
console.log("Built media pipeline passed: four still categories; six-frame golden GIF; 5+5/3+2 allocations; explicit disposal 1/2/3 and transparency; unknown-duration rejection; missed/focused 20-ms transient; exact/per-source/aggregate frame/pixel/raw-byte bounds; invalid windows, cancellation and worker deadline. No live-model/media evidence.");
