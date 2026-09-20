import { describe, expect, it, vi } from "vitest";
import { createHostAdapter } from "./host-adapter";

describe("host adapter", () => {
  it("uses a privacy-minimal standalone fallback outside an iframe", async () => {
    const standalone = {
      matchMedia: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    };
    Object.assign(standalone, { self: standalone, top: standalone });
    vi.stubGlobal("window", standalone);
    await expect(createHostAdapter().initialize()).resolves.toEqual({
      kind: "standalone",
      theme: "default",
      showEnglishNotice: true
    });
  });
});
