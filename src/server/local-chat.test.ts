import { expect, it } from "vitest";
import { loadLocalChatConfig } from "./local-chat-config";
import { loadVisualConfig, validProfile, visualReadiness } from "./visual-config";
import { loadLocalCatalog } from "./local-catalog";
import { eligible } from "./visual-retrieval";
import { AnalysisSessions, type AnalysisSession } from "./analysis-session";
import { GraphContext } from "./graph-context";
import { MediaResolver } from "./media-resolver";
import { ModelGateway, buildProcessingReview } from "./model-gateway";
import { AnalysisService } from "./analysis-service";

it("separates interactive development from fixed synthetic and production authorization", () => {
  const config = loadLocalChatConfig("offline-only");
  expect(config.executionScope).toBe("development-local");
  expect(config.processorApproved).toBe(false);
  expect(validProfile(config.profile)).toBe(false);
  expect(validProfile(config.profile, Date.now(), config.executionScope)).toBe(true);
  expect(visualReadiness(config).model.ready).toBe(false);
  expect(loadVisualConfig({ VISUAL_EXECUTION_SCOPE: "development-local" }).executionScope).toBeUndefined();
});
it("local interactive gateway denies an unconsented reviewed request", async () => {
  const config = loadLocalChatConfig("offline-only");
  const input = { version: 0, intent: "Self-authored test", context: [], preferences: {
    source: "requester-reported" as const, confirmed: true, outputLanguage: "en" as const,
    formality: "unknown" as const, familiarity: "", relationship: "", humor: "", avoid: ""
  } };
  const review = buildProcessingReview(input, { samples: [], coverage: [] }, config.profile!, undefined, config.executionScope);
  let calls = 0;
  const gateway = new ModelGateway(config, async () => { calls++; return new Response(); });
  await expect(gateway.run(review.body, review.review, new AbortController().signal)).rejects.toThrow("model-capability-unverified");
  expect(calls).toBe(0);
});
it("real catalog shortfall and revoked local permission block without production approval", async () => {
  const config = loadLocalChatConfig("offline-only"), catalog = await loadLocalCatalog(), sessions = new AnalysisSessions();
  const denied = async () => { throw new Error("No graph"); }, graph = new GraphContext(config, denied);
  let accepted: string | undefined;
  const service = new AnalysisService(sessions, config, graph, new MediaResolver(config, graph, denied), new ModelGateway(config, denied),
    catalog.assets, asset => catalog.permits(asset, accepted));
  const s: AnalysisSession = { id: "local-only", binding: { invocationId: "local-only", tenantId: "", userId: "", commandId: "recommendVisual", commandContext: "compose" },
    accessToken: "", expiresAt: Date.now() + 60_000, version: 1, shareVersion: 1, abort: new AbortController(), sources: new Map(), mediaSources: new Map() };
  const input = { version: 0, intent: "Support", context: [], preferences: { source: "requester-reported" as const, confirmed: true,
    outputLanguage: "en" as const, formality: "unknown" as const, familiarity: "", relationship: "", humor: "", avoid: "" } };
  try {
    expect(() => service.review(s, input)).toThrow("insufficient-candidates");
    accepted = catalog.digest;
    expect(service.review(s, input).imageCount).toBe(0);
    accepted = undefined;
    expect(() => service.review(s, input)).toThrow("insufficient-candidates");
    expect(catalog.assets.every(a => a.rights.approved === false)).toBe(true);
  } finally { sessions.dispose(); }
});
it("loads actual hashed originals without granting production rights", async () => {
  const catalog = await loadLocalCatalog();
  expect(catalog.assets).toHaveLength(8);
  expect(catalog.assets.every(a => !eligible(a))).toBe(true);
  expect(catalog.review.every(a => a.hashes.length > 1 && a.provenance.includes("Undetermined"))).toBe(true);
  expect(catalog.assets.filter(a => a.public.category !== "emoji")).toHaveLength(8);
});
