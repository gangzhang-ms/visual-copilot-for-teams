import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { CatalogAsset } from "../catalog/visual-catalog";
import { AnalysisSessions } from "./analysis-session";
import { GraphContext } from "./graph-context";
import { loadAudience } from "./audience-context";
import { loadVisualConfig, type ModelProfile } from "./visual-config";
import { buildProcessingReview, ModelGateway, validateExplanation } from "./model-gateway";
import { eligible, retrieve, validateRanking } from "./visual-retrieval";
import { ShareHandler } from "./share-handler";
import { decode } from "./media-worker";
import { sniff } from "./media-normalizer";
import { publicAddress } from "./media-resolver";
const profile: ModelProfile = { version: "synthetic-v1", endpoint: "https://synthetic.openai.azure.com/", deployment: "fixture", modelVersion: "fixture", apiVersion: "fixture",
  validUntil: Date.now() + 600_000, evidence: "SYNTHETIC TEST ONLY", verified: true, imageCap: 10, requestBytes: 12 * 1024 * 1024, inputTokens: 12000,
  outputTokens: 2000, contextTokens: 16000, imageTokenUpperBound: 100, accounting: "utf8-upper-bound", completionField: "max_tokens" };
const config = () => ({ ...loadVisualConfig({}), graphVerified: true, processorApproved: true, modelKey: "synthetic-only", profile: structuredClone(profile) });
function setup() {
  const store = new AnalysisSessions();
  const bootstrap = store.bootstrap({ invocationId: "i", tenantId: "t", userId: "u", commandId: "recommendVisual", commandContext: "message", target: { kind: "chat", conversationId: "c", selectedId: "m" } });
  const session = store.get(store.authenticate(bootstrap, "t", "u", "PRIVATE_TOKEN_SENTINEL"));
  return { store, session };
}
function asset(i: number): CatalogAsset {
  return { public: { id: `fixture-${i}`, version: "1", category: "image", imageUrl: `https://synthetic.example.test/visuals/${i}.png`, alt: `Synthetic art ${i}`,
    notices: { version: "1", creator: "Synthetic creator", source: "Synthetic source", license: "TEST ONLY permission",
      text: ["Mandatory synthetic attribution"], links: [] } }, safe: true, tags: ["support"],
    rights: { version: "1", approved: true, evidence: "PRIVATE_INTERNAL_RIGHTS_SENTINEL", validFrom: 0, validUntil: Date.now() + 600_000,
      withdrawn: false, publicHosting: true, redistribution: true, transformations: true, poster: true, downstreamRecallRequired: false },
    rendition: { version: "1", digest: "synthetic-digest", rightsVersion: "1", noticeVersion: "1", verifiedAvailable: true, transformation: "original" } };
}
const input = { version: 1, intent: "Support 👩🏽‍💻", context: [{ label: "C1", text: "PRIVATE_CONTEXT_SENTINEL", included: true, timestamp: "" }],
  preferences: { source: "requester-reported" as const, confirmed: true, outputLanguage: "zh-CN" as const, familiarity: "", formality: "unknown" as const, relationship: "", humor: "", avoid: "" } };
describe("P3 bounded Graph, audience and current access", () => {
  it("makes zero calls before retrieval consent; bounds context and records partiality", async () => {
    const { store, session } = setup();
    const message = (id: string) => ({ id, createdDateTime: "2026-01-01T00:00:00Z", lastModifiedDateTime: "1", body: { content: "context", contentType: "text" } });
    const transport = vi.fn(async (url: any) => new Response(JSON.stringify(String(url).includes("?") ? { value: Array.from({ length: 20 }, (_, i) => message(String(i))), "@odata.nextLink": "DO_NOT_FOLLOW" } : message("m"))));
    const graph = new GraphContext(config(), transport);
    await expect(graph.load(session, false)).rejects.toThrow("permission-denied"); expect(transport).not.toHaveBeenCalled();
    const result = await graph.load(session, true);
    expect(result.snippets).toHaveLength(12); expect(result.partial).toBe(true); expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(call => !String(call[0]).includes("/replies"))).toBe(true);
    transport.mockImplementation(async () => new Response("{}", { status: 403 }));
    await expect(graph.revalidate(session)).rejects.toThrow("permission-denied"); store.dispose();
  });
  it("limits roster to 50 and never includes email or inferred preferences", async () => {
    const { store, session } = setup();
    const transport = vi.fn(async () => new Response(JSON.stringify({ value: Array.from({ length: 51 }, (_, i) => ({ id: `opaque-${i}`, displayName: "Synthetic", email: "PRIVATE_EMAIL" })) })));
    const result = await loadAudience(new GraphContext(config(), transport), session, true);
    expect(result.members).toHaveLength(50); expect(result.partial).toBe(true); expect(JSON.stringify(result)).not.toContain("PRIVATE_EMAIL"); store.dispose();
  });
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"])("rejects non-public media address %s", address => expect(publicAddress(address)).toBe(false));
});
describe("P4 model limits and actual bounded decoder", () => {
  it("decodes synthetic PNG pixels with finite metadata/work and rejects MIME spoof", async () => {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#4a8aaf" } }).png().toBuffer();
    expect(sniff(bytes)).toBe("image/png"); expect(sniff(Buffer.from("<html>"))).toBe("");
    const limits = { verified: true, maxFrames: 10, maxPixels: 1000, maxDecodedBytes: 10000, timeoutMs: 1000, memoryMb: 64 };
    const result = await decode({ bytes, limits }); expect(result.pages).toBe(1); expect(result.data?.length).toBe(64);
    await expect(decode({ bytes, limits: { ...limits, maxPixels: 1 } })).rejects.toThrow();
  });
  it("counts complete UTF-8 request and combined context; bounds unknown/stale profiles", () => {
    const { body, review } = buildProcessingReview(input, { samples: [], coverage: [] }, profile);
    expect(review.serializedBytes).toBe(Buffer.byteLength(body));
    expect(body).toContain("👩🏽‍💻");
    expect(() => buildProcessingReview(input, { samples: [], coverage: [] }, { ...profile, validUntil: 1 })).toThrow();
    expect(() => buildProcessingReview(input, { samples: [], coverage: [] }, { ...profile, requestBytes: 1 })).toThrow("request-byte-budget-exceeded");
    expect(() => buildProcessingReview(input, { samples: [], coverage: [] }, { ...profile, inputTokens: 1 })).toThrow("request-token-budget-exceeded");
  });
  it("sends nothing without processor approval, suspends contract rejection without shrinking", async () => {
    const built = buildProcessingReview(input, { samples: [], coverage: [] }, profile), transport = vi.fn(async () => new Response("{}", { status: 413 }));
    await expect(new ModelGateway({ ...config(), processorApproved: false }, transport).run(built.body, built.review, new AbortController().signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    const gateway = new ModelGateway(config(), transport);
    await expect(gateway.run(built.body, built.review, new AbortController().signal)).rejects.toThrow("model-contract-rejected");
    await expect(gateway.run(built.body, built.review, new AbortController().signal)).rejects.toThrow("model-capability-unverified");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("retries identical transient request once, never repairs refusals or truncation", async () => {
    const built = buildProcessingReview(input, { samples: [], coverage: [] }, profile);
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] })));
    await expect(new ModelGateway(config(), transport).run(built.body, built.review, new AbortController().signal)).rejects.toThrow("model-output-truncated");
    expect(transport).toHaveBeenCalledTimes(2); expect(transport.mock.calls[0][1]?.body).toBe(transport.mock.calls[1][1]?.body);
  });
  it("rejects invented frame/context references and unsafe markup", () => {
    const output = { background:{source:null,context:null,frames:[]},observations: [{ text: "Visible", frames: ["invented"] }], commonUsage: ["Possible"], contextualInterpretations: [{ text: "Possible", context: [] }], uncertainties: ["Unknown"], safeResponseGuidance: ["Ask"] };
    expect(() => validateExplanation(output, [], [])).toThrow("model-output-invalid");
    output.observations = [{ text: "<script>bad</script>", frames: [] }];
    expect(() => validateExplanation(output, [], [])).toThrow("model-output-invalid");
  });
});
describe("P6/P7 governed candidates and exact signed draft cards", () => {
  it("requires 6 eligible pool entries, returns exactly three known distinct non-emoji IDs", () => {
    const catalog = Array.from({ length: 6 }, (_, i) => asset(i)), pool = retrieve(catalog, "support");
    const candidates = validateRanking(pool.slice(0, 3).map(a => ({ id: a.public.id, reason: "Private reason", caution: "Unknown audience" })), pool);
    expect(candidates).toHaveLength(3);
    expect(() => retrieve(catalog.slice(0, 2), "support")).toThrow("insufficient-candidates");
    expect(() => validateRanking([{ id: "invented", reason: "r", caution: "c" }], pool)).toThrow();
    catalog[0].rights.withdrawn = true; expect(eligible(catalog[0])).toBe(false);
    catalog[0].rights.withdrawn = false; catalog[0].rights.downstreamRecallRequired = true; expect(eligible(catalog[0])).toBe(false);
  });
  it("keeps mandatory notices in main/preview with empty caption and rejects withdrawal even on retry", () => {
    const { store, session } = setup(), catalog = Array.from({ length: 6 }, (_, i) => asset(i));
    const candidates = validateRanking(catalog.slice(0, 3).map(a => ({ id: a.public.id, reason: "PRIVATE_REASON_SENTINEL", caution: "PRIVATE_CAUTION_SENTINEL" })), catalog);
    session.result = { status: "ready", kind: "recommendations", candidates, profileVersion: "synthetic" };
    const handler = new ShareHandler(catalog, true), preview = handler.prepare(session, candidates[0].visual.id, "", true);
    const output = handler.submit(preview.handle, preview.digest, session.binding, "signed-request");
    expect(handler.submit(preview.handle, preview.digest, session.binding, "signed-request")).toEqual(output);
    const serialized = JSON.stringify(output);
    for (const secret of ["PRIVATE_REASON_SENTINEL", "PRIVATE_CAUTION_SENTINEL", "PRIVATE_TOKEN_SENTINEL", "PRIVATE_INTERNAL_RIGHTS_SENTINEL"]) expect(serialized).not.toContain(secret);
    expect(serialized.match(/Mandatory synthetic attribution/g)).toHaveLength(2);
    expect(() => handler.submit(preview.handle, preview.digest, { ...session.binding, userId: "other" }, "signed-request")).toThrow();
    catalog[0].rights.withdrawn = true;
    expect(() => handler.submit(preview.handle, preview.digest, session.binding, "signed-request")).toThrow("asset-rights-unavailable");
    handler.dispose(); store.dispose();
  });
});
