import sharp from "sharp";
import { AnalysisService } from "./analysis-service";
import { AnalysisSessions, digest, type AnalysisSession } from "./analysis-session";
import { GraphContext, type Transport } from "./graph-context";
import { MediaResolver } from "./media-resolver";
import { normalizeMedia } from "./media-normalizer";
import { ModelGateway } from "./model-gateway";
import { developmentSettings, loadDevelopmentModelConfig } from "./development-model";
import { VisualError } from "./visual-errors";
import type { ReviewInput } from "../shared/types";

const cases = [
  { id: "en-A", language: "en", text: "Fabricated puzzle A: the red square means proceed; the blue circle means wait." },
  { id: "en-B", language: "en", text: "Fabricated puzzle B: the red square means wait; the blue circle means proceed." },
  { id: "zh-A", language: "zh-CN", text: "虚构谜题甲：红色正方形代表继续，蓝色圆形代表等待。" },
  { id: "zh-B", language: "zh-CN", text: "虚构谜题乙：红色正方形代表等待，蓝色圆形代表继续。" }
] as const;

export async function geometricPng() {
  const pixels = Buffer.alloc(128 * 128 * 3, 255);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const square = x >= 16 && x < 56 && y >= 44 && y < 84;
    const circle = (x - 96) ** 2 + (y - 64) ** 2 <= 16 ** 2;
    if (square || circle) {
      const i = (y * 128 + x) * 3;
      pixels[i] = square ? 255 : 0; pixels[i + 1] = 0; pixels[i + 2] = circle ? 255 : 0;
    }
  }
  return sharp(pixels, { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer();
}

// No file, URL, conversation, session capability, or free-text inputs are accepted.
export async function runDevelopmentSynthetic(key: string, provider: Transport = fetch, pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const config = loadDevelopmentModelConfig(key), sessions = new AnalysisSessions();
  const allowed = new Set<string>(); config.syntheticRequestDigests = allowed;
  const expectedUrl = `${config.profile!.endpoint.replace(/\/$/, "")}/openai/deployments/${config.profile!.deployment}/chat/completions?api-version=${config.profile!.apiVersion}`;
  let requests = 0, graphRequests = 0;
  const dispatches: { status: number; elapsedMs: number }[] = [];
  const guarded: Transport = async (url, options) => {
    if (String(url) !== expectedUrl || options?.method !== "POST" || typeof options.body !== "string"
      || !allowed.delete(digest(options.body)) || requests >= 4) throw new VisualError("permission-denied");
    requests++;
    const started = performance.now();
    const response = await provider(url, options);
    dispatches.push({ status: response.status, elapsedMs: Math.round(performance.now() - started) });
    return response;
  };
  const denyGraph: Transport = async () => { graphRequests++; throw new VisualError("permission-denied"); };
  const graph = new GraphContext(config, denyGraph), resolver = new MediaResolver(config, graph, denyGraph);
  const service = new AnalysisService(sessions, config, graph, resolver, new ModelGateway(config, guarded), []);
  const source = await geometricPng(), started = performance.now();
  const results: object[] = [];
  try {
    const media = await normalizeMedia([{ id: "original-geometric", bytes: source, mime: "image/png", category: "image" }],
      config.profile!, config.mediaLimits!, new AbortController().signal, config.executionScope);
    const decoderMs = Math.round(performance.now() - started);
    if (media.samples.length !== 1 || media.samples[0].width !== 128 || media.samples[0].height !== 128) throw new VisualError("processing-review-required");
    for (const [index, fixture] of cases.entries()) {
      if (index > 0) await pause(61_000);
      // This object never enters the auth/session store and has no token or Teams target.
      const session: AnalysisSession = {
        id: fixture.id, accessToken: "", binding: { invocationId: "synthetic-only", tenantId: "", userId: "",
          commandId: "explainVisual", commandContext: "compose" },
        expiresAt: Date.now() + 60_000, version: 1, shareVersion: 1, abort: new AbortController(),
        sources: new Map(), mediaSources: new Map(), media: structuredClone(media)
      };
      const input: ReviewInput = {
        version: 1, intent: "Explain the visible shapes and possible meaning in this fabricated puzzle. Do not assume universal color meanings.",
        context: [{ label: "fabricated-puzzle", text: fixture.text, timestamp: "", included: true }],
        preferences: { source: "requester-reported", outputLanguage: fixture.language, confirmed: true,
          familiarity: "unknown", formality: "unknown", relationship: "unknown", humor: "", avoid: "" }
      };
      const begin = performance.now();
      try {
        const review = service.review(session, input);
        allowed.add(review.digest);
        const result = await service.process(session, review.digest);
        if (result.status !== "ready" || result.kind !== "explanation") throw new VisualError("model-output-invalid");
        results.push({ case: fixture.id, status: "passed", elapsedMs: Math.round(performance.now() - begin),
          serializedBytes: review.serializedBytes, conservativeInputTokens: review.inputTokens, outputReserve: review.outputReserve,
          requestDigest: review.digest, imageDigest: media.samples[0].digest, explanation: result.explanation });
      } catch (error) {
        results.push({ case: fixture.id, status: "failed", code: error instanceof VisualError ? error.code : "synthetic-validation-failed" });
        break;
      } finally {
        allowed.clear(); sessions.invalidate(session); delete session.media;
      }
    }
    return {
      scope: "development-synthetic-only", recordedAt: new Date().toISOString(), apiVersion: config.profile!.apiVersion,
      deployment: config.profile!.deployment, modelVersion: config.profile!.modelVersion, profileVersion: config.profile!.version,
      providerRequests: requests, graphRequests, dispatches, decoderMs, sourcePngBytes: source.length,
      normalizedPngBytes: media.samples[0].bytes, limits: developmentSettings.mediaLimits,
      allPassed: results.length === 4 && results.every((r: any) => r.status === "passed"),
      acceptance: "Schema/reference and fixed-pixel context wiring only. Human semantic quality and full H03 remain unverified.",
      results
    };
  } finally { sessions.dispose(); source.fill(0); allowed.clear(); config.modelKey = undefined; }
}
