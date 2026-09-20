import { expect, it, vi } from "vitest";
import { loadDevelopmentModelConfig } from "./development-model";
import { loadVisualConfig, validMediaLimits, validProfile, visualReadiness } from "./visual-config";
import { buildProcessingReview, ModelGateway, preflight } from "./model-gateway";
import { registerVisualRoutes } from "./visual-routes";

const input = { version: 1, intent: "Explain this synthetic drawing.", context: [], preferences: {
  source: "requester-reported" as const, confirmed: true, outputLanguage: "en" as const,
  familiarity: "", formality: "unknown" as const, relationship: "", humor: "", avoid: ""
} };
it("keeps development capability evidence and authorization separate from production", () => {
  const c = loadDevelopmentModelConfig("synthetic-test-key");
  expect(c.processorApproved).toBe(false);
  expect(c.profile?.verified).toBe(false);
  expect(c.mediaLimits?.verified).toBe(false);
  expect(validProfile(c.profile)).toBe(false);
  expect(validMediaLimits(c.mediaLimits)).toBe(false);
  expect(validProfile(c.profile, Date.now(), "development-synthetic")).toBe(true);
  expect(Object.values(visualReadiness(c)).every(v => !v.ready)).toBe(true);
  expect(loadVisualConfig({ VISUAL_EXECUTION_SCOPE: "development-synthetic" }).executionScope).toBeUndefined();
  expect(() => registerVisualRoutes({} as any, {} as any, c)).toThrow("model-capability-unverified");
});
it("does not dispatch arbitrary reviewed data under synthetic authorization", async () => {
  const c = loadDevelopmentModelConfig("synthetic-test-key"), transport = vi.fn();
  const built = buildProcessingReview(input, { samples: [], coverage: [] }, c.profile!, undefined, c.executionScope);
  await expect(new ModelGateway(c, transport).run(built.body, built.review, new AbortController().signal)).rejects.toThrow("model-capability-unverified");
  expect(transport).not.toHaveBeenCalled();
});
it("rejects absent credentials and expired development profiles", () => {
  expect(() => loadDevelopmentModelConfig("")).toThrow("development-credential-unavailable");
  const c = loadDevelopmentModelConfig("synthetic-test-key");
  expect(validProfile({ ...c.profile!, validUntil: 1 }, Date.now(), c.executionScope)).toBe(false);
  expect(() => buildProcessingReview(input, { samples: [], coverage: [] }, c.profile!)).toThrow("model-capability-unverified");
});
it("bounds real development retries and keeps provider error contents private", async () => {
  const c = loadDevelopmentModelConfig("synthetic-test-key");
  const built = buildProcessingReview(input, { samples: [], coverage: [] }, c.profile!, undefined, c.executionScope);
  c.syntheticRequestDigests = new Set([built.review.digest]);
  const transport = vi.fn(async () => new Response("sensitive-provider-error", { status: 429 }));
  await expect(new ModelGateway(c, transport).run(built.body, built.review, new AbortController().signal)).rejects.toThrow("busy");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("enforces development byte/token/image caps without making production evidence", () => {
  const c = loadDevelopmentModelConfig("synthetic-test-key"), p = c.profile!, media = { samples: [], coverage: [] };
  expect(() => preflight("x".repeat(65537), p, media, 0, 1000, c.executionScope)).toThrow("request-byte-budget-exceeded");
  expect(() => preflight("x", p, media, 7489, 1000, c.executionScope)).toThrow("request-token-budget-exceeded");
  expect(() => preflight("x", p, { samples: [{}, {}] as any, coverage: [] }, 0, 1000, c.executionScope)).toThrow("image-budget-exceeded");
  expect(validProfile(p, Date.now(), "invented" as any)).toBe(false);
  expect(validMediaLimits(c.mediaLimits, "invented" as any)).toBe(false);
});
it("stops revoked or cancelled synthetic requests before dispatch", async () => {
  const c = loadDevelopmentModelConfig("synthetic-test-key"), transport = vi.fn();
  const built = buildProcessingReview(input, { samples: [], coverage: [] }, c.profile!, undefined, c.executionScope);
  c.syntheticRequestDigests = new Set([built.review.digest]);
  c.processorApproved = true;
  await expect(new ModelGateway(c, transport).run(built.body, built.review, new AbortController().signal)).rejects.toThrow("model-capability-unverified");
  c.processorApproved = false;
  await expect(new ModelGateway(c, transport).run(built.body, built.review, AbortSignal.abort())).rejects.toThrow("cancelled");
  expect(transport).not.toHaveBeenCalled();
});
