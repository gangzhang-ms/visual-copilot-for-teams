import { listEnabledCatalog } from "../catalog/emoji-catalog";
import type { AbstentionReason, CatalogEntry, RecommendationInput, RecommendationResult } from "../shared/types";

export type ValidationResult = { valid: true; context: string } | { valid: false; message: string };

export function validateRecommendationInput(input: RecommendationInput): ValidationResult {
  const context = input.context.trim();
  if (context.length === 0) return { valid: false, message: "Enter conversation context." };
  if (context.length > 2000) return { valid: false, message: "Context must be 2,000 characters or fewer." };
  return { valid: true, context };
}

const matches = (text: string, pattern: RegExp) => pattern.test(text);
const unsupported = (text: string) =>
  /[\u3400-\u9fff\u3040-\u30ff\u0400-\u04ff]/u.test(text) ||
  matches(text, /\b(merci|aide|nous|terminé|désolé|panne|d'accord)\b/i);

function abstain(reason: AbstentionReason): RecommendationResult {
  return { status: "abstained", mode: "deterministic", items: [], reason };
}

export function recommend(input: RecommendationInput, catalog: readonly CatalogEntry[] = listEnabledCatalog()): RecommendationResult {
  const validation = validateRecommendationInput(input);
  if (!validation.valid) throw new Error(validation.message);
  const text = validation.context.toLocaleLowerCase("en-US");

  if (unsupported(text)) return abstain("unsupported-language");
  if (matches(text, /\b(useless|should quit|idiot|hate you|shut up)\b/i)) return abstain("sensitive");
  if (/^okay[.…!?\s]*$/i.test(text) || text.split(/\s+/).length < 2) return abstain("ambiguous");

  const serious = matches(text, /\b(passed away|loss|grief|outage|exposed|breach|incident|sorry|blocked|failure|failed|deadline)\b/i);
  const sarcasm = matches(text, /\bgreat\b.*\b(another|outage|failure|exactly what we needed)\b/i);

  let tags: string[];
  if (matches(text, /\b(passed away|loss|grief|sorry)\b/i)) tags = ["empathy", "support"];
  else if (sarcasm || matches(text, /\b(exposed|breach|outage|incident)\b/i)) tags = ["attention", "thoughtful"];
  else if (matches(text, /\b(thank|thanks|appreciate|grateful)\b/i)) tags = ["appreciation"];
  else if (matches(text, /\b(shipped|release|green|milestone|completed|finished|success)\b/i)) tags = ["celebration", "complete"];
  else if (matches(text, /\b(i agree|proposal|proceed|approved|sounds good)\b/i)) tags = ["agreement"];
  else if (matches(text, /\b(blocked|could use help|you've got this|keep going)\b/i)) tags = ["support", "attention"];
  else if (matches(text, /\b(review|take a look|investigation|consider|design|question)\b/i)) tags = ["attention", "thoughtful"];
  else return abstain("no-safe-match");

  const tone = serious ? "professional" : input.tone;
  const candidates = catalog
    .filter((entry) => entry.enabled)
    .filter((entry) => entry.tags.some((tag) => tags.includes(tag)))
    .filter((entry) => !serious || entry.safetyClass !== "playful")
    .sort((a, b) => a.rank[tone] - b.rank[tone] || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((entry) => ({
      ...entry,
      rationaleTemplate: `Recommended for ${tags[0]} context.`,
      provenance: "catalog-rule" as const
    }));

  if (candidates.length === 0) return abstain("no-safe-match");
  return { status: "recommendations", mode: "deterministic", items: candidates as [typeof candidates[number], ...typeof candidates] };
}
