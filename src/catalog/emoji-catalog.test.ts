import { describe, expect, it } from "vitest";
import { emojiCatalog, validateCatalog } from "./emoji-catalog";

describe("emoji catalog", () => {
  it("contains ten complete, unique enabled records", () => {
    expect(() => validateCatalog(emojiCatalog)).not.toThrow();
    expect(emojiCatalog).toHaveLength(10);
    for (const entry of emojiCatalog) {
      expect(entry).toMatchObject({ enabled: true });
      for (const field of ["id", "emoji", "label", "meaning", "appropriateWhen", "caution", "altText"]) {
        expect(entry[field as keyof typeof entry]).toBeTruthy();
      }
    }
  });

  it("rejects duplicate and incomplete fixtures", () => {
    expect(() => validateCatalog([...emojiCatalog, emojiCatalog[0]])).toThrow();
    expect(() => validateCatalog([{ ...emojiCatalog[0], label: "" }, ...emojiCatalog.slice(1)])).toThrow();
  });
});
