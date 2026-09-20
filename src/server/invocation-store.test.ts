import { describe, expect, it } from "vitest";
import type { InvocationEnvelope } from "../shared/types";
import { InvocationStore } from "./invocation-store";
const envelope: InvocationEnvelope = { selected: { mode: "manual", context: "" }, binding: { invocationId: "i", tenantId: "t", userId: "u", commandId: "recommendEmoji", commandContext: "compose" } };
describe("invocation store", () => {
  it("returns canonical CSPRNG claim once and deduplicates fetch", () => {
    const store = new InvocationStore();
    const token = store.createOrGet("key", envelope);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.createOrGet("key", envelope)).toBe(token);
    expect(store.counts()).toEqual({ envelopes: 1, idempotency: 1 });
    expect(store.claim(token)).toEqual(envelope);
    expect(store.claim(token)).toBeUndefined();
  });
  it("expires without persistence and fails replay/restart identically", () => {
    let now = 0;
    const store = new InvocationStore(() => now, () => Buffer.alloc(32, 7));
    const token = store.createOrGet("key", envelope);
    now = 300_001;
    expect(store.claim(token)).toBeUndefined();
    expect(new InvocationStore().claim(token)).toBeUndefined();
  });
  it("fails at capacity without eviction", () => {
    const store = new InvocationStore();
    for (let index = 0; index < 100; index++) store.createOrGet(`key-${index}`, { ...envelope, binding: { ...envelope.binding, invocationId: String(index) } });
    expect(() => store.createOrGet("overflow", envelope)).toThrow();
    expect(store.counts().envelopes).toBe(100);
  });
  it("permits exactly one winner across claim races", async () => {
    const store = new InvocationStore();
    const token = store.createOrGet("key", envelope);
    const results = await Promise.all(Array.from({ length: 36 }, async () => store.claim(token)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
