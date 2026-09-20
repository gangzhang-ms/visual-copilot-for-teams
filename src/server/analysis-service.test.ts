import { expect, it, vi } from "vitest";
import { AnalysisService } from "./analysis-service";
import { AnalysisSessions } from "./analysis-session";
import { GraphContext } from "./graph-context";
import { MediaResolver } from "./media-resolver";
import { ModelGateway } from "./model-gateway";
import { loadVisualConfig, type VisualConfig } from "./visual-config";
const config = (): VisualConfig => ({ ...loadVisualConfig({}), processorApproved: true, modelKey: "synthetic-only", profile: {
  version: "SYNTHETIC", endpoint: "https://synthetic.openai.azure.com/", deployment: "test", modelVersion: "test", apiVersion: "test", verified: true, evidence: "TEST ONLY",
  validUntil: Date.now() + 600_000, imageCap: 10, requestBytes: 12_000_000, inputTokens: 12_000, outputTokens: 2000, contextTokens: 16_000, imageTokenUpperBound: 100,
  accounting: "utf8-upper-bound", completionField: "max_tokens" } });
const input = { version: 0, intent: "👩🏽‍💻", context: [{ label: "manual", text: "Synthetic release succeeded", timestamp: "", included: true }], preferences: {
  source: "requester-reported" as const, outputLanguage: "en" as const, confirmed: true, familiarity: "", formality: "unknown" as const, relationship: "", humor: "", avoid: "" } };
const validOutput = { background:{source:null,context:null,frames:[]},observations: [{ text: "Emoji sequence supplied", frames: [] }], commonUsage: ["Technical work"], contextualInterpretations: [{ text: "Possible appreciation, not sender intent", context: ["manual"] }],
  uncertainties: ["Meaning is uncertain"], safeResponseGuidance: ["Ask for clarification"] };
function setup(transport: typeof fetch) {
  const sessions = new AnalysisSessions(), c = config(), graph = new GraphContext(c, vi.fn()), resolver = new MediaResolver(c, graph, vi.fn());
  const bootstrap = sessions.bootstrap({ invocationId: "i", tenantId: "t", userId: "u", commandId: "explainVisual", commandContext: "message" });
  const session = sessions.get(sessions.authenticate(bootstrap, "t", "u", "server-only"));
  return { sessions, session, service: new AnalysisService(sessions, c, graph, resolver, new ModelGateway(c, transport), []) };
}
it("separates immutable reviewed consent from dispatch and invalidates results on edits", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validOutput) } }] })));
  const { service, sessions, session } = setup(transport);
  await expect(service.process(session, "not-reviewed")).rejects.toThrow();
  const snapshot = service.review(session, input);
  expect(transport).not.toHaveBeenCalled();
  await expect(service.process(session, "wrong-digest")).rejects.toThrow();
  const result = await service.process(session, snapshot.digest);
  expect(result.status).toBe("ready"); expect(transport).toHaveBeenCalledTimes(1);
  await expect(service.process(session, snapshot.digest)).rejects.toThrow();
  sessions.invalidate(session); expect(session.result).toBeUndefined(); sessions.dispose();
});
it("discards a late model result after cancellation", async () => {
  let finish!: (value: Response) => void;
  const transport = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  const { service, sessions, session } = setup(transport), snapshot = service.review(session, input);
  const result = service.process(session, snapshot.digest);
  await vi.waitFor(() => expect(transport).toHaveBeenCalled());
  sessions.invalidate(session);
  finish(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validOutput) } }] })));
  await expect(result).rejects.toThrow("cancelled"); expect(session.result).toBeUndefined(); sessions.dispose();
});
it("prevents culture-identity fields from entering voluntary preferences", () => {
  const { service, sessions, session } = setup(vi.fn());
  expect(() => service.review(session, { ...input, preferences: { ...input.preferences, ethnicity: "inferred" } as any })).toThrow("processing-review-required");
  sessions.dispose();
});
it("caps combined service work at eight and frees slots on cancellation", async () => {
  const transport = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  }));
  const { service, sessions, session } = setup(transport);
  const all = [session];
  for (let i = 1; i < 9; i++) {
    const bootstrap = sessions.bootstrap({ invocationId: `i${i}`, tenantId: "t", userId: `u${i}`, commandId: "explainVisual", commandContext: "message" });
    all.push(sessions.get(sessions.authenticate(bootstrap, "t", `u${i}`, "synthetic")));
  }
  const snapshots = all.map(s => service.review(s, input));
  const running = all.slice(0, 8).map((s, i) => service.process(s, snapshots[i].digest).catch(error => error.message));
  await expect(service.process(all[8], snapshots[8].digest)).rejects.toThrow("busy");
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(8));
  all.slice(0, 8).forEach(s => sessions.invalidate(s));
  expect(await Promise.all(running)).toEqual(Array(8).fill("cancelled"));
  sessions.dispose();
});
