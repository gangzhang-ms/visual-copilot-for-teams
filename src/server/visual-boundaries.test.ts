import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogAsset } from "../catalog/visual-catalog";
import type { MediaPreview, ReviewInput, VisualTarget } from "../shared/types";
import { AnalysisSessions, digest } from "./analysis-session";
import { boundedBody, GraphContext, selectedPath } from "./graph-context";
import { buildProcessingReview, ModelGateway, preflight } from "./model-gateway";
import { loadVisualConfig, type ModelProfile } from "./visual-config";
import { ShareHandler, publicCard } from "./share-handler";
import { eligible } from "./visual-retrieval";
import {loadLocalChatConfig} from "./local-chat-config";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const profile = (): ModelProfile => ({ version: "synthetic-boundaries", endpoint: "https://synthetic.openai.azure.com/",
  deployment: "fixture", modelVersion: "fixture", apiVersion: "fixture", evidence: "LOCAL TEST ONLY", verified: true,
  validUntil: Date.now() + 600_000, imageCap: 10, requestBytes: 12 * 1024 * 1024, inputTokens: 12000,
  outputTokens: 2000, contextTokens: 16000, imageTokenUpperBound: 100, accounting: "utf8-upper-bound", completionField: "max_tokens" });
const input: ReviewInput = { version: 1, intent: "Support", context: [],
  preferences: { source: "requester-reported", confirmed: true, outputLanguage: "en", familiarity: "", formality: "unknown", relationship: "", humor: "", avoid: "" } };
function sessionFor(target: VisualTarget) {
  const store = new AnalysisSessions();
  const bootstrap = store.bootstrap({ invocationId: "fixture", tenantId: "tenant", userId: "user",
    commandId: "recommendVisual", commandContext: "message", target });
  return { store, session: store.get(store.authenticate(bootstrap, "tenant", "user", "LOCAL_TOKEN_SENTINEL")) };
}
const channel = (selectedId?: string): Extract<VisualTarget, { kind: "channel" }> => ({ kind: "channel",
  conversationId: "bound-channel-conversation", teamId: "11111111-1111-4111-8111-111111111111",
  channelId: "19:channel@thread.tacv2", rootId: "root", selectedId });
const message = (id: string) => ({ id, createdDateTime: "2026-09-14T00:00:00Z", lastModifiedDateTime: "v1", body: { contentType: "text", content: `text ${id}` } });

it("keeps the Teams twelve-context contract while local processing independently caps included messages at ten",()=>{
  const context=Array.from({length:12},(_,i)=>({label:String(i),text:"x",timestamp:"",included:true}));
  const media={samples:[],coverage:[]},local=loadLocalChatConfig("OFFLINE-CONTEXT-TEST",true).profile!;
  const read=(body:string)=>JSON.parse(JSON.parse(body).messages[1].content[0].text).context;
  expect(read(buildProcessingReview({...input,context},media,profile()).body)).toHaveLength(12);
  expect(()=>buildProcessingReview({...input,context:context.slice(0,11)},media,local,undefined,"development-local")).toThrow("local-context-limit");
  expect(read(buildProcessingReview({...input,context:context.map((c,i)=>({...c,included:i<10}))},media,local,undefined,"development-local").body)).toHaveLength(10);
});

describe("channel root/reply and target snapshots", () => {
  it.each(["root", "reply", undefined])("loads a bounded thread for selected %s without paging into unrelated threads", async selected => {
    const { store, session } = sessionFor(channel(selected));
    const transport = vi.fn<typeof fetch>(async url => {
      const path = String(url);
      return new Response(JSON.stringify(path.includes("?") ? {
        value: [message("reply"), ...Array.from({ length: 12 }, (_, n) => message(`reply-${n}`))],
        "@odata.nextLink": "https://unrelated.example.test/do-not-follow"
      } : message(path.endsWith("/root") ? "root" : "reply")));
    });
    try {
      const graph = new GraphContext({ ...loadVisualConfig({}), graphVerified: true }, transport);
      const result = await graph.load(session, true);
      expect(result.provenance).toBe("channel-thread"); expect(result.partial).toBe(true); expect(result.snippets).toHaveLength(12);
      expect(result.snippets.slice(0, 2).map(s => s.text)).toEqual(selected === "reply" ? ["text reply", "text root"] : ["text root", "text reply"]);
      expect(transport).toHaveBeenCalledTimes(selected === "reply" ? 3 : 2);
      const paths = transport.mock.calls.map(c => String(c[0]));
      expect(paths.at(-1)).toMatch(/\/messages\/root\/replies\?\$top=12$/);
      expect(paths.every(p => p.startsWith("https://graph.microsoft.com/v1.0/teams/") && !p.includes("unrelated"))).toBe(true);
      expect(session.sources.size).toBe(12);
      expect([...session.sources.keys()].filter(p => p.endsWith("/replies/reply"))).toHaveLength(1);
      transport.mockImplementation(async url => new Response(JSON.stringify({ ...message(String(url).split("/").at(-1)!), lastModifiedDateTime: "changed" })));
      await expect(graph.revalidate(session)).rejects.toThrow("processing-review-required");
    } finally { store.dispose(); }
  });
  it("encodes root/reply segments and rejects missing-root and deleted-message variants", async () => {
    const target = { ...channel("reply/#?"), rootId: "root/#?" };
    expect(selectedPath(target)).toMatch(/\/root%2F%23%3F\/replies\/reply%2F%23%3F$/);
    const { store, session } = sessionFor({ ...channel("reply"), rootId: undefined });
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ...message("root"), deletedDateTime: "2026-09-14" })));
    const graph = new GraphContext({ ...loadVisualConfig({}), graphVerified: true }, transport);
    try {
      await expect(graph.load(session, true)).rejects.toThrow("target-unavailable"); expect(transport).not.toHaveBeenCalled();
      session.binding.target = channel("root");
      transport.mockImplementation(async url => new Response(JSON.stringify(String(url).includes("?") ? { value: [] } : { ...message("root"), deletedDateTime: "2026-09-14" })));
      await expect(graph.load(session, true)).rejects.toThrow("target-unavailable");
    } finally { store.dispose(); }
  });
  it("bounds the selected chat window before its timestamp and rejects invalid selected timestamps", async () => {
    const { store, session } = sessionFor({ kind: "chat", conversationId: "chat", selectedId: "selected" });
    const transport = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).includes("?") ? { value: [] } : message("selected"))));
    const graph = new GraphContext({ ...loadVisualConfig({}), graphVerified: true }, transport);
    try {
      await graph.load(session, true);
      expect(new URL(String(transport.mock.calls[1][0])).searchParams.get("$filter")).toBe("createdDateTime lt 2026-09-14T00:00:00.000Z");
      transport.mockClear(); transport.mockImplementation(async () => new Response(JSON.stringify({ ...message("selected"), createdDateTime: "unknown" })));
      await expect(graph.load(session, true)).rejects.toThrow("target-unavailable"); expect(transport).toHaveBeenCalledTimes(1);
    } finally { store.dispose(); }
  });
});

describe("exact request limits and finite dispatch", () => {
  it("accepts exact UTF-8 byte/token/context bounds and rejects one over each independent limit", () => {
    const p = profile(), media = { samples: [], coverage: [] };
    const built = buildProcessingReview(input, media, p);
    const exact = { ...p, requestBytes: built.review.serializedBytes, inputTokens: built.review.inputTokens,
      contextTokens: built.review.inputTokens + built.review.outputReserve };
    expect(buildProcessingReview(input, media, exact).body).toBe(built.body);
    for (const key of ["requestBytes", "inputTokens", "contextTokens"] as const) {
      expect(() => buildProcessingReview(input, media, { ...exact, [key]: exact[key] - 1 })).toThrow(key === "requestBytes" ? "request-byte-budget-exceeded" : "request-token-budget-exceeded");
    }
    expect(() => preflight("{}", p, media, 1, p.outputTokens + 1)).toThrow("request-token-budget-exceeded");
    expect(() => buildProcessingReview({ ...input, context: Array.from({ length: 13 }, () => ({ label: "C", text: "", included: false, timestamp: "" })) }, media, p)).toThrow("request-token-budget-exceeded");
    expect(() => buildProcessingReview({ ...input, context: [{ label: "C", text: "x".repeat(8001), included: true, timestamp: "" }] }, media, p)).toThrow("request-token-budget-exceeded");
  });
  it("uses combined image cap and detects a stale digest or understated image bytes", () => {
    const data = Buffer.from("synthetic-normalized-image"), p = profile();
    const sample = { id: "frame", assetId: "asset", digest: digest(data), mime: "image/png" as const,
      width: 1, height: 1, bytes: data.length, timestampMs: 0, frameIndex: 0, dataUrl: `data:image/png;base64,${data.toString("base64")}` };
    const media: MediaPreview = { samples: Array.from({ length: 10 }, () => ({ ...sample })), coverage: [] };
    expect(preflight("{}", p, media, 1, 1).imageCount).toBe(10);
    expect(() => preflight("{}", { ...p, imageCap: 9 }, media, 1, 1)).toThrow("image-budget-exceeded");
    expect(() => preflight("{}", p, { ...media, samples: [...media.samples, sample] }, 1, 1)).toThrow("image-budget-exceeded");
    expect(() => preflight("{}", p, { ...media, samples: [{ ...sample, digest: "stale" }] }, 1, 1)).toThrow("processing-review-required");
    expect(() => preflight("{}", p, { ...media, samples: [{ ...sample, bytes: 1 }] }, 1, 1)).toThrow("processing-review-required");
  });
  it("bounds streamed response bytes without trusting Content-Length", async () => {
    const body = () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(3)); c.enqueue(new Uint8Array(2)); c.close(); } }));
    expect((await boundedBody(body(), 5, new AbortController().signal)).length).toBe(5);
    await expect(boundedBody(body(), 4, new AbortController().signal)).rejects.toThrow("request-byte-budget-exceeded");
    await expect(boundedBody(new Response("x", { headers: { "Content-Length": "6" } }), 5, new AbortController().signal)).rejects.toThrow("request-byte-budget-exceeded");
    await expect(boundedBody(body(), 5, AbortSignal.abort())).rejects.toThrow("cancelled");
  });
  it("accounts exact 2-MiB samples, 8-MiB aggregate and 20-MP metadata, rejecting one over", () => {
    const sample = (size: number) => {
      const bytes = Buffer.alloc(size);
      return { id: "synthetic-accounting", assetId: "asset", mime: "image/png" as const, bytes: size, digest: digest(bytes),
        width: 5000, height: 4000, timestampMs: 0, frameIndex: 0, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
    };
    const full = sample(2 * 1024 * 1024), p = profile(), media = { samples: [full, full, full, full], coverage: [] };
    expect(preflight("{}", p, media, 1, 1).imageCount).toBe(4);
    expect(() => preflight("{}", p, { ...media, samples: [...media.samples, sample(1)] }, 1, 1)).toThrow("request-byte-budget-exceeded");
    expect(() => preflight("{}", p, { ...media, samples: [sample(2 * 1024 * 1024 + 1)] }, 1, 1)).toThrow("processing-review-required");
    expect(() => preflight("{}", p, { ...media, samples: [{ ...full, width: 20_000_001, height: 1 }] }, 1, 1)).toThrow("processing-review-required");
  });
  it("enforces the 45-second overall model deadline without another attempt", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms); return controller.signal;
    });
    const p = profile(), built = buildProcessingReview(input, { samples: [], coverage: [] }, p);
    const transport = vi.fn<typeof fetch>(async (_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true })));
    const gateway = new ModelGateway({ ...loadVisualConfig({}), processorApproved: true, modelKey: "synthetic", profile: p }, transport);
    let settled = false;
    const running = gateway.run(built.body, built.review, new AbortController().signal).finally(() => { settled = true; });
    const rejected = expect(running).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(44_999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await rejected;
    expect(timeout).toHaveBeenCalledWith(45_000); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("admits eight requests, rejects the ninth, releases capacity on cancellation and dispatches nothing after pre-cancel", async () => {
    const p = profile(), built = buildProcessingReview(input, { samples: [], coverage: [] }, p);
    const transport = vi.fn<typeof fetch>(async (_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true })));
    const gateway = new ModelGateway({ ...loadVisualConfig({}), processorApproved: true, modelKey: "synthetic", profile: p }, transport);
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const running = controllers.map(c => expect(gateway.run(built.body, built.review, c.signal)).rejects.toThrow("cancelled"));
    await expect(gateway.run(built.body, built.review, new AbortController().signal)).rejects.toThrow("busy");
    expect(transport).toHaveBeenCalledTimes(8); controllers.forEach(c => c.abort()); await Promise.all(running);
    await expect(gateway.run(built.body, built.review, AbortSignal.abort())).rejects.toThrow("cancelled");
    expect(transport).toHaveBeenCalledTimes(8);
    transport.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] })));
    expect(await gateway.run(built.body, built.review, new AbortController().signal)).toEqual({ ok: true });
  });
  it("does not retry after the verified capability profile expires during a transient response", async () => {
    const p = profile(), built = buildProcessingReview(input, { samples: [], coverage: [] }, p);
    const transport = vi.fn<typeof fetch>(async () => { p.validUntil = Date.now(); return new Response("{}", { status: 503 }); });
    const gateway = new ModelGateway({ ...loadVisualConfig({}), processorApproved: true, modelKey: "synthetic", profile: p }, transport);
    await expect(gateway.run(built.body, built.review, new AbortController().signal)).rejects.toThrow("model-capability-unverified");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

function noticeAsset(): CatalogAsset {
  return { public: { id: "notice-fixture", version: "1", category: "gif", imageUrl: "https://synthetic.example.test/poster.png",
    animationUrl: "https://synthetic.example.test/animation.gif", alt: "Synthetic poster",
    notices: { version: "1", source: "Original synthetic source", creator: "Fixture creator", license: "TEST ONLY",
      text: ["Required credit", "修改说明 / transformation notice"], links: [{ label: "Terms", url: "https://synthetic.example.test/terms" }] } },
  safe: true, tags: [], rights: { version: "1", approved: true, evidence: "LOCAL_PRIVATE_EVIDENCE", validFrom: 0,
    validUntil: Date.now() + 600_000, withdrawn: false, publicHosting: true, redistribution: true, transformations: true,
    poster: true, downstreamRecallRequired: false },
  rendition: { version: "1", digest: "local-poster-digest", rightsVersion: "1", noticeVersion: "1", verifiedAvailable: true, transformation: "derived" },
  original: { version: "1", digest: "local-gif-digest", rightsVersion: "1", verifiedAvailable: true, url: "https://synthetic.example.test/animation.gif" } };
}
describe("server-built public notices and local card overflow", () => {
  it.each(["", "Optional caption"])("preserves every notice in main/preview with caption %j and no clipping directive", caption => {
    const asset = noticeAsset(), card = publicCard(asset, caption);
    expect(eligible(asset)).toBe(true);
    const textBlocks = card.content.body.filter(b => b.type === "TextBlock");
    expect(textBlocks.every(b => "wrap" in b && b.wrap)).toBe(true);
    expect(JSON.stringify(card)).not.toMatch(/maxLines|LOCAL_PRIVATE_EVIDENCE|LOCAL_TOKEN_SENTINEL/);
    for (const required of [asset.public.notices.source, asset.public.notices.creator, asset.public.notices.license,
      ...asset.public.notices.text, asset.public.notices.links[0].url, asset.public.animationUrl!]) {
      expect(JSON.stringify(card.content)).toContain(required); expect(card.preview.content.text).toContain(required);
    }
    expect(card.preview.content.images?.[0].url).toBe(asset.public.imageUrl);
  });
  it("rejects unrenderable multibyte notice payload instead of truncating or issuing a handle", () => {
    const { store, session } = sessionFor({ kind: "chat", conversationId: "chat" }), asset = noticeAsset();
    asset.public.notices.text = Array.from({ length: 8 }, () => "声".repeat(500));
    expect(eligible(asset)).toBe(true);
    session.result = { status: "ready", kind: "recommendations", candidates: Array.from({ length: 3 }, () => ({
      visual: structuredClone(asset.public), reason: "PRIVATE_REASON", caution: "PRIVATE_CAUTION"
    })) as any, profileVersion: "synthetic" };
    const handler = new ShareHandler([asset], true);
    try {
      expect(Buffer.byteLength(JSON.stringify(publicCard(asset, "")))).toBeGreaterThanOrEqual(20_000);
      expect(() => handler.prepare(session, asset.public.id, "", true)).toThrow("attribution-unrenderable");
      expect(session.shareVersion).toBe(1);
    } finally { handler.dispose(); store.dispose(); }
  });
});
