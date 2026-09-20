import { describe, expect, it } from "vitest";
import { visualReadiness, loadVisualConfig } from "./visual-config";
import { AnalysisSessions } from "./analysis-session";

describe("P1 readiness and P2 session foundation", () => {
  it("does not enable external processing from credentials or approval alone", () => {
    const config = loadVisualConfig({});
    expect(Object.values(visualReadiness(config)).every(c => !c.ready)).toBe(true);
    expect(visualReadiness(loadVisualConfig({ VISUAL_PROCESSOR_APPROVED: "true" })).model.ready).toBe(false);
  });
  it("binds bootstrap to signed identity, consumes once, expires and aborts work", () => {
    let now = 1;
    const sessions = new AnalysisSessions(() => now);
    const bootstrap = sessions.bootstrap({ invocationId: "i", tenantId: "t", userId: "u", commandId: "explainVisual", commandContext: "message", target: { kind: "chat", conversationId: "c", selectedId: "m" } });
    expect(() => sessions.authenticate(bootstrap, "t", "other", "private-token")).toThrow();
    const capability = sessions.authenticate(bootstrap, "t", "u", "private-token");
    expect(() => sessions.authenticate(bootstrap, "t", "u", "private-token")).toThrow();
    const session = sessions.get(capability);
    sessions.invalidate(session);
    expect(session.version).toBe(2);
    now = 600_002; sessions.cleanup();
    expect(() => sessions.get(capability)).toThrow();
    expect(session.abort.signal.aborted).toBe(true);
    sessions.dispose();
  });
});
