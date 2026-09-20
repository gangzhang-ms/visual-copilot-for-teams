import { Worker } from "node:worker_threads";
import type { MediaPreview, VisualCategory } from "../shared/types";
import { digest } from "./analysis-session";
import type { ExecutionScope, MediaLimits, ModelProfile } from "./visual-config";
import { validMediaLimits, validProfile } from "./visual-config";
import { requireVisual, VisualError } from "./visual-errors";
import { generatedWorkerLease } from "./local-generation-config";
export function allocateSamples(available: number[], budget: number) {
  requireVisual(Number.isInteger(budget) && budget > 0 && available.length <= 2 && available.every(n => Number.isInteger(n) && n > 0), "image-budget-exceeded");
  const counts = available.map(n => Math.min(n, 2));
  requireVisual(counts.reduce((a, b) => a + b, 0) <= Math.min(10, budget), "image-budget-exceeded");
  let remaining = Math.min(10, budget) - counts.reduce((a, b) => a + b, 0);
  while (remaining > 0) {
    let changed = false;
    for (let i = 0; i < counts.length && remaining > 0; i++) if (counts[i] < Math.min(6, available[i])) { counts[i]++; remaining--; changed = true; }
    if (!changed) break;
  }
  return counts;
}
export function sampleIndices(delays: number[], count: number, window: [number, number]) {
  const duration = delays.reduce((a, b) => a + b, 0);
  requireVisual(window[0] >= 0 && window[1] > window[0] && window[1] <= duration && window[1] - window[0] <= 20_000, "decoder-budget-exceeded");
  const result = new Set<number>();
  for (let n = 0; n < count; n++) {
    const time = window[0] + (count === 1 ? 0 : n * (window[1] - window[0] - 1) / (count - 1));
    let end = 0; const index = delays.findIndex(d => (end += d) > time); result.add(index);
  }
  return [...result].sort((a, b) => a - b);
}
export interface SourceVisual { id: string; bytes: Buffer; mime: string; category: VisualCategory; window?: [number, number]; crop?: { left: number; top: number; width: number; height: number } }
type Decoded = { data: Uint8Array; width: number; height: number; pages: number; delays: number[] };
export async function normalizeMedia(sources: SourceVisual[], profile: ModelProfile, limits: MediaLimits, signal: AbortSignal, scope: ExecutionScope = "production"): Promise<MediaPreview> {
  requireVisual(validProfile(profile, Date.now(), scope) && validMediaLimits(limits, scope), "model-capability-unverified");
  requireVisual(sources.length <= 2, "image-budget-exceeded");
  const callerSignal = signal;
  signal = AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)]);
  const decoded: Decoded[] = [];
  for (const source of sources) {
    requireVisual(source.bytes.length <= 10 * 1024 * 1024 && sniff(source.bytes) === source.mime, "unsupported-format");
    decoded.push(await inWorker({ bytes: source.bytes, limits, metadataOnly: true }, limits, signal, callerSignal));
  }
  requireVisual(decoded.reduce((sum, d) => sum + d.width * d.height * d.pages * 4, 0) <= limits.maxDecodedBytes &&
    decoded.reduce((sum, d) => sum + d.width * d.height * d.pages, 0) <= limits.maxPixels &&
    decoded.reduce((sum, d) => sum + d.pages, 0) <= limits.maxFrames, "decoder-budget-exceeded");
  const counts = allocateSamples(decoded.map(d => d.pages), profile.imageCap);
  const result: MediaPreview = { samples: [], coverage: [] }; let totalBytes = 0;
  for (let asset = 0; asset < sources.length; asset++) {
    const source = sources[asset], d = await inWorker({ bytes: source.bytes, limits }, limits, signal, callerSignal);
    const duration = d.delays.reduce((a, b) => a + b, 0), window = source.window ?? [0, Math.min(20_000, duration)] as [number, number];
    const indices = d.pages === 1 ? [0] : sampleIndices(d.delays, counts[asset], window);
    requireVisual(source.mime !== "image/gif" || d.pages >= 2 && indices.length >= 2, "processing-review-required");
    for (const index of indices) {
      requireVisual(!signal.aborted, callerSignal.aborted ? "cancelled" : "decoder-budget-exceeded");
      const stride = d.width * d.height * 4;
      const encoded = await inWorker({ raw: d.data.slice(index * stride, (index + 1) * stride), width: d.width, height: d.height, crop: source.crop }, limits, signal, callerSignal);
      const data = Buffer.from(encoded.data);
      totalBytes += data.length;
      requireVisual(data.length <= 2 * 1024 * 1024 && totalBytes <= 8 * 1024 * 1024, "request-byte-budget-exceeded");
      const timestampMs = d.delays.slice(0, index).reduce((a, b) => a + b, 0);
      result.samples.push({ id: `asset-${asset + 1}-frame-${index}`, assetId: source.id, digest: digest(data), mime: "image/png", width: encoded.width, height: encoded.height,
        bytes: data.length, timestampMs, frameIndex: index, dataUrl: `data:image/png;base64,${data.toString("base64")}` });
    }
    result.coverage.push({ mode: d.pages > 1 ? "sampled-stills" : "still", category: source.category, window, durationMs: duration, omitted: d.pages > 1,
      limitation: d.pages > 1 ? "Sampled stills only: intervening content, motion and timing may be missed. Not full GIF interpretation." : "One normalized still; metadata removed, pixels are not anonymized." });
  }
  return result;
}
async function inWorker(data: object, limits: MediaLimits, signal: AbortSignal, callerSignal: AbortSignal): Promise<Decoded> {
  requireVisual(!generatedWorkerLease.busy, "busy");
  const lease = generatedWorkerLease.acquire();
  try { return await new Promise<Decoded>((resolve, reject) => {
    const worker = new Worker(new URL("./media-worker.js", import.meta.url), { env: {}, workerData: data, resourceLimits: { maxOldGenerationSizeMb: limits.memoryMb } });
    let finished = false;
    const finish = (error?: VisualError, value?: Decoded) => {
      if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      worker.terminate().then(() => {
        if(signal.aborted&&!error)error=new VisualError(callerSignal.aborted?"cancelled":"decoder-budget-exceeded");
        error ? reject(error) : resolve(value!);
      }, () => { generatedWorkerLease.poison(); reject(new VisualError("decoder-budget-exceeded")); });
    };
    const abort = () => finish(new VisualError(callerSignal.aborted ? "cancelled" : "decoder-budget-exceeded"));
    const timer = setTimeout(() => finish(new VisualError("decoder-budget-exceeded")), limits.timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    worker.once("error", () => finish(new VisualError("unsupported-format")));
    worker.once("message", value => value.ok ? finish(undefined, value) : finish(new VisualError(value.code)));
    worker.once("exit", () => { if (!finished) finish(new VisualError("unsupported-format")); });
    if (signal.aborted) abort();
  }); } finally { lease.release(); }
}
export function sniff(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString())) return "image/gif";
  return "";
}
