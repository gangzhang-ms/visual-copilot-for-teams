import { describe, expect, it } from "vitest";
import { emojiCatalog } from "../catalog/emoji-catalog";
import { frozenScenarios } from "../../tests/fixtures/scenarios";
import { recommend, validateRecommendationInput } from "./recommender";
import type { Tone } from "../shared/types";

const input = (context: string, tone: Tone = "balanced") => ({ context, tone, locale: "en-US" as const });

describe("recommender", () => {
  it.each(frozenScenarios)("%s satisfies its frozen outcome", (_id, context, status) => {
    const result = recommend(input(context));
    expect(result.status).toBe(status);
    expect(result.mode).toBe("deterministic");
    if (result.status === "recommendations") {
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.length).toBeLessThanOrEqual(3);
      expect(new Set(result.items.map((item) => item.id)).size).toBe(result.items.length);
      expect(result.items.every((item) => item.provenance === "catalog-rule")).toBe(true);
    }
  });

  it("keeps playful results out of every sensitive scenario", () => {
    for (const context of frozenScenarios.slice(5, 11).map((scenario) => scenario[1])) {
      for (const tone of ["professional", "balanced", "playful"] as const) {
        const result = recommend(input(context, tone));
        if (result.status === "recommendations") {
          expect(result.items.every((item) => item.safetyClass !== "playful")).toBe(true);
        }
      }
    }
  });

  it("is deterministic and catalog-contained", () => {
    const known = new Set(emojiCatalog.map((entry) => entry.id));
    for (const [, context] of frozenScenarios) {
      const first = recommend(input(context));
      for (let iteration = 0; iteration < 20; iteration++) expect(recommend(input(context))).toEqual(first);
      if (first.status === "recommendations") expect(first.items.every((item) => known.has(item.id))).toBe(true);
    }
  });

  it("validates UTF-16 boundaries before ranking", () => {
    expect(validateRecommendationInput(input(" ")).valid).toBe(false);
    expect(validateRecommendationInput(input("a")).valid).toBe(true);
    expect(validateRecommendationInput(input("a".repeat(2000))).valid).toBe(true);
    expect(validateRecommendationInput(input("a".repeat(2001))).valid).toBe(false);
  });

  it("abstains for unsupported-language and unknown input", () => {
    expect(recommend(input("Merci pour votre aide"))).toMatchObject({ status: "abstained", reason: "unsupported-language" });
    expect(recommend(input("Routine words without a matching signal"))).toMatchObject({ status: "abstained", reason: "no-safe-match" });
  });

  it("never returns disabled records", () => {
    const catalog = emojiCatalog.map((entry) => entry.id === "thanks" ? { ...entry, enabled: false } : entry);
    const result = recommend(input("Thanks for your help"), catalog);
    if (result.status === "recommendations") expect(result.items.map((item) => item.id)).not.toContain("thanks");
  });

  it("contains 1,000 fixed-seed Unicode inputs to valid outcomes", () => {
    let seed = 0x7f3a;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    const alphabet = ["a", "é", "你", "🙂", " ", "thanks", "review", "outage"];
    const enabled = new Set(emojiCatalog.filter((entry) => entry.enabled).map((entry) => entry.id));
    for (let fixture = 0; fixture < 1000; fixture++) {
      const context = Array.from({ length: 2 + (next() % 20) }, () => alphabet[next() % alphabet.length]).join(" ");
      const result = recommend(input(context, ["professional", "balanced", "playful"][next() % 3] as Tone));
      expect(result.items.length).toBeLessThanOrEqual(3);
      expect(new Set(result.items.map((item) => item.id)).size).toBe(result.items.length);
      expect(result.items.every((item) => enabled.has(item.id))).toBe(true);
    }
  });
});
