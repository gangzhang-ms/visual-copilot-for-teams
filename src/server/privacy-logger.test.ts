import { describe, expect, it } from "vitest";
import { PrivacyLogger, SilentSdkLogger } from "./privacy-logger";
describe("privacy-safe logging", () => {
  it("accepts fixed event names and aggregate counts only", () => {
    const logger = new PrivacyLogger(); logger.record("claim_rejected"); logger.record("claim_rejected");
    expect(logger.count("claim_rejected")).toBe(2);
    expect(Object.keys(logger)).not.toContain("payload");
  });
  it("silences SDK diagnostics", () => expect(new SilentSdkLogger().child()).toBeInstanceOf(SilentSdkLogger));
});
