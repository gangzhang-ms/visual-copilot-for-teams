import { describe, expect, it, vi } from "vitest";
import { copyPreview } from "./clipboard";

describe("copyPreview", () => {
  it("writes only after being called explicitly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const preview = { focus: vi.fn(), select: vi.fn() } as unknown as HTMLTextAreaElement;
    expect(await copyPreview("🙏", preview)).toEqual({ copied: true });
    expect(writeText).toHaveBeenCalledWith("🙏");
  });

  it("selects the preview when clipboard is denied", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error()) } });
    const select = vi.fn();
    const preview = { focus: vi.fn(), select } as unknown as HTMLTextAreaElement;
    expect(await copyPreview("🙏", preview)).toMatchObject({ copied: false });
    expect(select).toHaveBeenCalled();
  });
});
