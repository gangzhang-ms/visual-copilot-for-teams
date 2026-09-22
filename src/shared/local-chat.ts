import type { MediaPreview, ProcessingReview, PublicVisual, ReviewInput } from "./types";
import type { ExpressionOptions,SpeakerProfile } from "./expression";
export const localOutputCaptionLimit=500;
export interface LocalMessage {
  id: string; speaker: string; text: string;
  attachment?: { dataUrl: string; category: "image" | "sticker" | "gif" };
  visual?: PublicVisual;
  generated?: LocalGeneratedVisual;
  createdAt?:number;
  demoTimeline?:true;
  demoMedia?:"illustration"|"local-motion"|"user-reference"|"custom-emoji";
}
export function hasLocalVisual(message:LocalMessage|undefined):boolean {
  return !!(message?.attachment?.dataUrl || message?.visual?.imageUrl || message?.visual?.animationUrl || message?.generated?.mediaUrl);
}
// Bare ASCII keycap bases, regional indicators and skin modifiers are not emoji sequences.
const unicodeEmoji=/(?:[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|(?!\p{Regional_Indicator}|\p{Emoji_Modifier})\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)/u;
export function containsUnicodeEmoji(text:string):boolean {
  return unicodeEmoji.test(text);
}
export function emojiSequences(text:string):string[] {
  return [...new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(text)]
    .map(part=>part.segment).filter(containsUnicodeEmoji);
}
export function selectedEmoji(text:string):string {return emojiSequences(text).join(" ");}
export function canExplainLocalMessage(message:LocalMessage|undefined):boolean {
  return !!message&&(hasLocalVisual(message)||containsUnicodeEmoji(message.text));
}
export interface LocalState {
  sharedRoom?:{chatId:string;expiresAt:number};
  emojiExpressions?:true;
  contextualCreation?:true;
  mixedCreation?:true;
  semanticCreation?:true;
  webCreation?:{configured:boolean;provider?:"Brave"|"Wikimedia Commons"|"Google Images via SerpApi";keyRequired?:boolean};
  creationChoices?:true;
  mediaBytes?:number;
  catalogSource?:"internet"|"original-demo";
  internetCatalog?:LocalCatalogReview;
  revision: number; messages: LocalMessage[]; catalogAccepted: boolean; cooldownUntil: number;
  providerRequests: number;
  generation?: LocalGenerationReadiness;
  interaction?:"direct-personal";
  outgoingSpeaker?:string;
  speakerProfiles?:{speaker:string;profile:SpeakerProfile}[];
}
export interface LocalCatalogReview {
  digest: string; assets: { visual: PublicVisual; provenance: string; hashes: { file: string; sha256: string }[] }[];
}
export interface LocalReview {
  processing: ProcessingReview; input: ReviewInput; media: MediaPreview; revision: number;
  catalog?: { id: string; alt: string; category: string; tags: string[] }[];
  generatedSource?: {assetId:string;version:number;sourceSide:512;analysisSide:128};
  profileSpeaker?:string;
}
export interface LocalInsertPreview { handle: string; visual: PublicVisual; caption: string; speaker: string }

export interface LocalGenerationDraft {
  visualContextId?:string;
  searchTerms?:string;
  allowPublicSearchReferences?:boolean;
  expression?:ExpressionOptions;
  intent: string; creative: string; output: "image" | "gif";
  context: { label: string; text: string; included: boolean }[];
  preferences: { source: "requester-reported"; language: "en" | "zh-CN"; culture: string; familiarity: string; tone: string; relationship: string; humor: string; avoid: string };
}
export interface GenerationDestination { account: string; deployment: string; model: string; modelVersion: string; region: string; sku: string; apiVersion: string }
export interface LocalGenerationReadiness { mode: "disabled" | "validation-only" | "ready"; ready: boolean; reason: string; remainingCalls: number|null; destination?: GenerationDestination;durable?:boolean;cooldownUntil?:number;expiresAt?:number;scope?:"personal-local-images"|"ongoing-personal" }
export interface LocalGenerationReview {
  operationId: string; digest: string; revision: number; draftRevision: number; expiresAt: number;
  prompt: string; body: string; output: "image" | "gif"; bodyBytes: number; dispatchable: boolean;
  destination?: GenerationDestination; profileVersion: string; budgetVersion: string;
}
export interface LocalGeneratedVisual {
  inspiration?:GenerationInspiration;
  assetId: string; version: number; variant: "image" | "animation"; category: "image" | "gif";
  posterUrl: string; mediaUrl: string; digest: string; width: 512; height: 512; alt: string;
  method: "generated-image" | "generated-image-local-animation"; model: string; modelVersion: string;
  recipe: "pan-zoom-v1"; pendingReview: true;
}
export interface LocalGenerationStatus {
  operationId: string; digest: string;
  status: "reviewed" | "dispatching" | "rendering" | "ready" | "failed" | "cancelled" | "expired" | "unknown-after-dispatch";
  code?: string; image?: LocalGeneratedVisual; animation?: LocalGeneratedVisual; animationFailed?: boolean;
  failure?: {stage:"provider"|"response"|"local-render";httpStatus?:number};
}
export interface LocalGeneratedInsertPreview { handle: string; generated: LocalGeneratedVisual; caption: string; speaker: string; revision: number }
export interface GenerationInspiration {
  mode:"popular-text"|"web-text"; provider:"Imgflip"|"Brave"|"Wikimedia Commons"|"Google Images via SerpApi"; fetchedAt:number;
  selection:"local-keyword-match"|"popular-fallback"|"model-semantic-match";
  references:{name:string;pattern:string;sourceUrl:string}[];
}
export type GenerationTreatment="requested"|"reaction-sticker"|"light-comic"|"playful-doodle"|"natural-photo"|"cinematic-photo";
export interface GenerationBatchOptions {count:1|3;referenceMode:"popular-text"|"none"}
export interface GenerationCandidate {
  kind:"generated";
  id:string; treatment:GenerationTreatment; attempts:number;
  operation:LocalGenerationStatus;
}
export type ExistingGenerationCandidate = {searchTerms?:string}&(
  | {kind:"existing";id:string;status:"ready";visual:PublicVisual;caption:string;captionOrigin:"verbatim-intent"|"manual-required"}
  | {kind:"existing";id:string;status:"failed"|"skipped"|"cancelled";code:string});
export type CreationChoice=GenerationCandidate|ExistingGenerationCandidate;
export interface LocalGenerationBatch {
  contextPlan?:ExpressVisualPlan;
  batchId:string; digest:string; revision:number; expiresAt:number; nextAttempt:number;
  status:"reviewed"|"running"|"paused"|"ready"|"cancelled";
  candidates:GenerationCandidate[]; inspiration?:GenerationInspiration;
  existing?:ExistingGenerationCandidate;
  cooldownUntil:number;
}
export const publicReplyMotifs=["none","train","bridge","path","small step","teamwork","support","rest","celebration","puzzle","balance","storm","fire","waiting","dilemma"] as const;
export interface ExpressVisualPlan {
  searchMotif:typeof publicReplyMotifs[number];
  hook:string|null;
  referenceChoice:"same-source"|"related"|"original"|"explicit";
  replyIntent:string;
  reason:string;
  adaptedCaption:string|null;
  familiarity:"unknown"|"mixed"|"familiar"|"unfamiliar";
  observedSources:(string|null)[];
  mode:"inherit"|"override"|"unanchored";
  kind:"fictional"|"callback"|"motif"|"none";
  franchise:string|null;
  characters:string[];
  subject:string;
  reaction:string;
  medium:"movie"|"video game"|"meme"|"photo"|"animation"|"illustration"|"unknown";
  visualStyle:import("./expression").ReplyVisualStyle;
  motif:string;
  subjectCount:number|null;
  certainty:"grounded"|"uncertain"|"none";
  evidence:string[];
  visualEvidence?:string[];
  query:string;
  digest:string;
}
export const planningFailureReasons=["schema","evidence","truncated","invalid-json","provider","unavailable"] as const;
export type PlanningFailureReason=typeof planningFailureReasons[number];
export const planningFields=["adaptedCaption","certainty","characters","evidence","familiarity","franchise","hook","kind","medium","mode","motif",
  "observedSources","reaction","reason","referenceChoice","replyIntent","searchMotif","subject","subjectCount","visualStyle"] as const;
export const planningIssueFields=["$",...planningFields,"query","reference","reference.kind","reference.choice","reference.sourceId","reference.work","reference.characters","reference.hook","appearance","appearance.style","appearance.frameId"] as const;
export const planningIssueTypes=["missing","null","array","object","string","number","boolean","other"] as const;
export const planningIssueRules=["type","missing","unexpected-fields","enum","empty","length","format","range","items","query",
  "audience-report-required","frame-count","source-name","unique-evidence","available-evidence","frame-evidence-required",
  "original-mode","explicit-mode","hook-kind","fictional-name-required","grounded-required","source-evidence-required",
  "explicit-reference-required","fictional-choice","inheritance-evidence","nonfictional-names","reference-choice","reference-mode","unanchored-reference"] as const;
export interface PlanningSchemaIssue {
  field:typeof planningIssueFields[number];
  actualType:typeof planningIssueTypes[number];
  rule:typeof planningIssueRules[number];
  actualLength?:number;
  limit?:number;
}
export function validPlanningSchemaIssue(value:unknown):value is PlanningSchemaIssue{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  const keys=Object.keys(v).sort().join(",");
  const measured=keys==="actualLength,actualType,field,limit,rule"&&v.rule==="length"&&v.actualType==="string"
    &&typeof v.actualLength==="number"&&Number.isSafeInteger(v.actualLength)&&v.actualLength<=64_000
    &&typeof v.limit==="number"&&Number.isSafeInteger(v.limit)&&v.limit>=0&&v.limit<=64_000&&v.actualLength>v.limit;
  return (keys==="actualType,field,rule"||measured)
    &&planningIssueFields.some(field=>field===v.field)&&planningIssueTypes.some(type=>type===v.actualType)&&planningIssueRules.some(rule=>rule===v.rule);
}
export interface LocalGenerationBatchReview extends LocalGenerationBatch {
  requests:LocalGenerationReview[];
}
