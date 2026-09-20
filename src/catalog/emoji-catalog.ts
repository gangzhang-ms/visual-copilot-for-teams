import type { CatalogEntry } from "../shared/types";
export const catalogVersion = "2026-08-17.v1";
export const reasonTemplates = Object.freeze({
  "context-match": "Matches the apparent intent of the context.",
  supportive: "Offers a supportive workplace response.",
  cautious: "Uses a restrained response for sensitive context."
});

const r = (professional: number, balanced: number, playful: number) =>
  ({ professional, balanced, playful }) as const;

export const emojiCatalog: readonly CatalogEntry[] = [
  { id: "acknowledge", emoji: "👍", label: "Acknowledge", meaning: "A clear acknowledgement.", appropriateWhen: "You want to confirm you saw or support a message.", caution: "Can feel brief in sensitive situations.", altText: "Thumbs up", tags: ["agreement", "neutral"], safetyClass: "neutral", enabled: true, rank: r(1, 2, 5) },
  { id: "teamwork", emoji: "🙌", label: "Great teamwork", meaning: "Recognizes a shared achievement.", appropriateWhen: "A team has succeeded together.", caution: "Avoid for setbacks or sensitive news.", altText: "Raising hands", tags: ["celebration", "appreciation"], safetyClass: "playful", enabled: true, rank: r(7, 2, 2) },
  { id: "celebrate", emoji: "🎉", label: "Celebrate", meaning: "Marks a clear success or milestone.", appropriateWhen: "There is unambiguous good news.", caution: "Avoid for incidents, loss, or sarcasm.", altText: "Party popper", tags: ["celebration"], safetyClass: "playful", enabled: true, rank: r(8, 1, 1) },
  { id: "warmth", emoji: "😊", label: "Warm response", meaning: "Adds friendly warmth.", appropriateWhen: "A friendly, low-stakes response fits.", caution: "May minimize serious concerns.", altText: "Smiling face", tags: ["appreciation", "neutral"], safetyClass: "warm", enabled: true, rank: r(6, 4, 3) },
  { id: "thanks", emoji: "🙏", label: "Thank you", meaning: "Expresses appreciation or support.", appropriateWhen: "Someone helped or needs quiet support.", caution: "Meaning can vary by culture.", altText: "Folded hands", tags: ["appreciation", "empathy"], safetyClass: "warm", enabled: true, rank: r(3, 3, 6) },
  { id: "attention", emoji: "👀", label: "Taking a look", meaning: "Signals attentive follow-up.", appropriateWhen: "A review or investigation is requested.", caution: "Can imply scrutiny; add words if unclear.", altText: "Eyes", tags: ["attention", "thoughtful"], safetyClass: "neutral", enabled: true, rank: r(4, 4, 7) },
  { id: "encourage", emoji: "💪", label: "Encouragement", meaning: "Offers positive support.", appropriateWhen: "A teammate is working through a challenge.", caution: "Avoid if it could dismiss distress.", altText: "Flexed biceps", tags: ["support"], safetyClass: "warm", enabled: true, rank: r(5, 3, 4) },
  { id: "consider", emoji: "🤔", label: "Considering", meaning: "Shows thoughtful consideration.", appropriateWhen: "A question or proposal needs thought.", caution: "May read as doubt.", altText: "Thinking face", tags: ["thoughtful", "neutral"], safetyClass: "neutral", enabled: true, rank: r(4, 5, 8) },
  { id: "confirm", emoji: "✅", label: "Confirmed", meaning: "Confirms agreement or completion.", appropriateWhen: "A decision or task is complete.", caution: "Do not imply completion prematurely.", altText: "Check mark button", tags: ["agreement", "complete"], safetyClass: "neutral", enabled: true, rank: r(1, 1, 5) },
  { id: "support", emoji: "❤️", label: "Care and support", meaning: "Conveys genuine care.", appropriateWhen: "Warm support is appropriate.", caution: "Use professional judgement and cultural awareness.", altText: "Red heart", tags: ["empathy", "support"], safetyClass: "warm", enabled: true, rank: r(6, 3, 7) }
];

export function validateCatalog(entries: readonly CatalogEntry[]): void {
  if (entries.filter((entry) => entry.enabled).length !== 10) throw new Error("Catalog must contain exactly ten enabled entries.");
  const ids = new Set<string>();
  const glyphs = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || !entry.emoji || !entry.label || !entry.meaning || !entry.appropriateWhen || !entry.caution || !entry.altText || entry.tags.length === 0) {
      throw new Error("Catalog entry is incomplete.");
    }
    if (ids.has(entry.id) || glyphs.has(entry.emoji)) throw new Error("Catalog IDs and glyphs must be unique.");
    ids.add(entry.id);
    glyphs.add(entry.emoji);
  }
}

validateCatalog(emojiCatalog);
export const listEnabledCatalog = () => emojiCatalog.filter((entry) => entry.enabled);
export const catalogById = new Map(emojiCatalog.map((entry) => [entry.id, entry]));
