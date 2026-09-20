export const tones = ["professional", "balanced", "playful"] as const;
export type Tone = (typeof tones)[number];
export type Theme = "default" | "dark" | "contrast";
export interface RecommendationInput { context: string; tone: Tone; locale: "en-US" }
export interface CatalogEntry {
  id: string; emoji: string; label: string; meaning: string; appropriateWhen: string;
  caution: string; altText: string; tags: readonly string[];
  safetyClass: "neutral" | "warm" | "playful"; enabled: boolean;
  rank: Readonly<Record<Tone, number>>;
}
export interface Recommendation extends CatalogEntry { rationaleTemplate: string; provenance: "catalog-rule" }
export type AbstentionReason = "sensitive" | "ambiguous" | "unsupported-language" | "no-safe-match";
export type RecommendationResult =
  | { status: "recommendations"; mode: "deterministic"; items: [Recommendation, ...Recommendation[]] }
  | { status: "abstained"; mode: "deterministic"; items: []; reason: AbstentionReason };
export interface NormalizedSelectedMessage {
  mode: "selected" | "manual";
  context: string;
  attachmentNotice?: string;
}
export interface InvocationBinding {
  invocationId: string; tenantId: string; userId: string;
  commandId: "recommendEmoji" | VisualCommand; commandContext: "compose" | "message";
  target?: VisualTarget;
}
export interface InvocationEnvelope { selected: NormalizedSelectedMessage; binding: InvocationBinding }
export interface ClaimResponse { schemaVersion: 1; invocationId: string; selected: NormalizedSelectedMessage; bootstrap?: string; command?: VisualCommand; teamsAppId?: string }
export interface CloseAction { schemaVersion: 1; action: "close"; invocationId: string }
export interface HostSnapshot { kind: "standalone" | "teams"; theme: Theme; showEnglishNotice: boolean }

export type VisualCommand = "explainVisual" | "recommendVisual";
export type Language = "en" | "zh-CN";
export type VisualCategory = "image" | "screenshot" | "meme" | "sticker" | "gif" | "emoji";
export type VisualTarget =
  | { kind: "chat"; conversationId: string; selectedId?: string }
  | { kind: "channel"; conversationId: string; teamId: string; channelId: string; rootId?: string; selectedId?: string };
export const failureCodes = ["local-context-limit", "model-request-envelope-exceeded", "local-message-capacity", "local-profile-capacity", "meme-source-unavailable", "meme-source-invalid", "auth-required", "auth-cancelled", "permission-denied", "target-unavailable", "media-unavailable", "unsupported-format", "not-configured", "host-unsupported", "expired", "busy", "local-session-capacity", "local-visual-required", "model-refused", "model-output-invalid", "model-output-invalid-json", "model-output-invalid-envelope", "model-output-invalid-schema", "model-output-invalid-references", "model-provider-auth", "model-provider-unavailable", "model-network-error", "model-output-truncated", "model-capability-unverified", "image-budget-exceeded", "request-byte-budget-exceeded", "request-token-budget-exceeded", "decoder-budget-exceeded", "processing-review-required", "model-contract-rejected", "asset-rights-unavailable", "share-review-required", "attribution-unrenderable", "timeout", "cancelled", "insufficient-candidates"] as const;
export type FailureCode = typeof failureCodes[number];
export type Failure = { status: "blocked" | "failed"; code: FailureCode };
export interface Capability { ready: boolean; code?: FailureCode }
export type Readiness = Record<"auth" | "context" | "audience" | "media" | "model" | "catalog" | "share", Capability>;
export interface ContextSnippet { label: string; text: string; timestamp: string; included: boolean }
export interface ContextPreview { snippets: ContextSnippet[]; partial: boolean; provenance: "selected" | "preceding-window" | "channel-thread" | "manual"; retrievedAt: number }
export interface AudiencePreview { members: { label: string; display: string }[]; partial: boolean; retrievedAt: number }
export interface AudiencePreferences {
  source: "requester-reported"; confirmed: boolean; outputLanguage: Language;
  familiarity: string; formality: "unknown" | "formal" | "casual"; relationship: string; humor: string; avoid: string;
}
export interface MediaCoverage {
  mode: "still" | "sampled-stills"; category: VisualCategory; window: [number, number];
  durationMs: number; omitted: boolean; limitation: string;
}
export interface MediaSample {
  id: string; assetId: string; digest: string; mime: "image/png" | "image/jpeg";
  width: number; height: number; bytes: number; timestampMs: number; frameIndex: number;
}
export interface MediaPreview { samples: (MediaSample & { dataUrl: string })[]; coverage: MediaCoverage[] }
export interface ReviewInput {
  explanationTarget?:{kind:"visual";originalCustomEmoji?:true;contextLabel?:string|null}|{kind:"emoji";emoji:string};
  speakerContext?:import("./expression").SpeakerContext;
  version: number; intent: string; context: ContextSnippet[]; preferences: AudiencePreferences;
}
export interface ProcessingReview { version: number; digest: string; profileVersion: string; imageCount: number; serializedBytes: number; inputTokens: number; outputReserve: number; media: MediaPreview }
export interface Explanation {
  background: { source: string | null; context: string | null; frames: string[] };
  observations: { text: string; frames: string[] }[]; commonUsage: string[];
  contextualInterpretations: { text: string; context: string[] }[]; uncertainties: string[]; safeResponseGuidance: string[];
}
export interface PublicNotices { version: string; source: string; creator: string; license: string; text: string[]; links: { label: string; url: string }[] }
export interface WebPreviewSize {width:number;height:number;downloadWidth:number;downloadHeight:number}
export interface PublicVisual {
  webSource?:{kind:"web-image-preview";provider:"Brave"|"Wikimedia Commons"|"Google Images via SerpApi";title:string;pageUrl:string;originalUrl?:string;query:string;  fetchedAt:number;attribution?:ImageAttribution;preview?:WebPreviewSize};
  template?:{kind:"popular-template";provider:"Imgflip";name:string;fetchedAt:number;sourceUrl:string;description:string};
  id: string; version: string; category: VisualCategory; alt: string; unicode?: string;
  imageUrl?: string; animationUrl?: string; notices: PublicNotices;
}
export interface ImageAttribution {artist:string;license:string;licenseUrl?:string;credit?:string;attribution?:string;restrictions?:string}
export interface VisualCandidate { visual: PublicVisual; reason: string; caution: string }
export type AnalysisResult =
  | { status: "ready"; kind: "explanation"; explanation: Explanation; coverage: MediaCoverage[]; profileVersion: string }
  | { status: "ready"; kind: "recommendations"; candidates: [VisualCandidate, VisualCandidate, VisualCandidate]; profileVersion: string }
  | Failure;
export interface SharePreviewDto { handle: string; digest: string; visual: PublicVisual; caption: string; destination: string; expiresAt: number; card: unknown }
