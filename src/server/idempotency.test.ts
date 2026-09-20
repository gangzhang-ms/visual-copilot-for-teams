import { describe, expect, it } from "vitest";
import { buildIdempotencyKey } from "./idempotency";
describe("idempotency key", () => {
  it("is stable, opaque, and field-delimited", () => {
    const value = { tenantId: "tenant", activityId: "activity", requestId: "request", commandId: "recommendEmoji", commandContext: "compose" };
    expect(buildIdempotencyKey(value)).toBe(buildIdempotencyKey(value));
    expect(buildIdempotencyKey(value)).not.toContain("tenant");
    expect(buildIdempotencyKey({ ...value, requestId: "other" })).not.toBe(buildIdempotencyKey(value));
  });
});
