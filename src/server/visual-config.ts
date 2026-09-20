import type { Readiness } from "../shared/types";
export interface ModelProfile {
  version: string; endpoint: string; deployment: string; modelVersion: string; apiVersion: string;
  validUntil: number|null; evidence: string; verified: boolean; validity?:"ongoing-personal";
  imageCap: number; requestBytes: number|null; inputTokens: number; outputTokens: number; contextTokens: number;
  imageTokenUpperBound: number; accounting: "utf8-upper-bound"; completionField: "max_tokens" | "max_completion_tokens";
  explanationFormat?: "json-schema";
}
export interface MediaLimits { verified: boolean; maxFrames: number; maxPixels: number; maxDecodedBytes: number; timeoutMs: number; memoryMb: number }
export interface SelectedFileMapping { selectedPath: string; attachmentId: string; contentUrlDigest: string; driveId: string; itemId: string; verified: boolean }
export type ExecutionScope = "production" | "development-synthetic" | "development-local";
export interface VisualConfig {
  authClientId?: string; authSecret?: string; redirectUri?: string;
  authVerified: boolean; graphVerified: boolean; processorApproved: boolean; shareVerified: boolean;
  modelKey?: string; profile?: ModelProfile; mediaLimits?: MediaLimits;
  fileReadsApproved: boolean; downloadHosts: string[];
  selectedFiles: SelectedFileMapping[];
  executionScope?: ExecutionScope;
  syntheticRequestDigests?: ReadonlySet<string>;
  localRequestDigests?: ReadonlySet<string>;
}
export function loadVisualConfig(env: Record<string, string | undefined>): VisualConfig {
  return {
    authClientId: env.AUTH_CLIENT_ID, authSecret: env.AUTH_CLIENT_SECRET, redirectUri: env.AUTH_REDIRECT_URI,
    authVerified: env.VISUAL_AUTH_VERIFIED === "true", graphVerified: env.VISUAL_GRAPH_VERIFIED === "true",
    processorApproved: env.VISUAL_PROCESSOR_APPROVED === "true", shareVerified: env.VISUAL_SHARE_VERIFIED === "true",
    modelKey: env.MODEL_API_KEY, profile: parse<ModelProfile>(env.MODEL_CAPABILITY_PROFILE),
    mediaLimits: parse<MediaLimits>(env.MEDIA_RESOURCE_LIMITS), fileReadsApproved: env.VISUAL_FILES_APPROVED === "true",
    downloadHosts: (env.VISUAL_DOWNLOAD_HOSTS ?? "").split(",").filter(Boolean),
    selectedFiles: parse<SelectedFileMapping[]>(env.VISUAL_SELECTED_FILES) ?? []
  };
}
function parse<T>(value?: string): T | undefined { try { return value ? JSON.parse(value) : undefined; } catch { return undefined; } }
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export function validProfile(p: ModelProfile | undefined, now = Date.now(), scope: ExecutionScope = "production"): p is ModelProfile {
  const ongoing=scope==="development-local"&&p?.validity==="ongoing-personal"&&p.validUntil===null
    &&p.endpoint==="https://your-azure-openai-resource.openai.azure.com/"&&p.deployment==="your-vision-deployment"
    &&p.modelVersion==="gpt-4.1-mini/2025-04-14"&&p.apiVersion==="2024-10-21";
  if (!["production", "development-synthetic", "development-local"].includes(scope) || !p || (scope === "production" ? p.verified !== true : p.verified !== false)
    || (p.explanationFormat!==undefined&&(p.explanationFormat!=="json-schema"||scope!=="development-local"
      ||p.modelVersion!=="gpt-4.1-mini/2025-04-14"||p.apiVersion!=="2024-10-21"))
    || ![p.evidence, p.version, p.deployment, p.modelVersion, p.apiVersion].every(v => typeof v === "string" && v.length > 0)
    || (p.validity==="ongoing-personal"&&!ongoing)||(!ongoing&&(!positive(p.validUntil)||p.validUntil===null||p.validUntil<=now))) return false;
  try {
    const endpoint = new URL(p.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || endpoint.search || !/^[a-z0-9-]+\.openai\.azure\.com$/.test(endpoint.hostname) || endpoint.pathname !== "/") return false;
  } catch { return false; }
  return (p.requestBytes===null?ongoing:positive(p.requestBytes))
    && [p.imageCap, p.inputTokens, p.outputTokens, p.contextTokens, p.imageTokenUpperBound].every(positive)
    && p.accounting === "utf8-upper-bound" && ["max_tokens", "max_completion_tokens"].includes(p.completionField);
}
export const modelTransportBytes=12*1024*1024;
export function modelRequestLimit(profile:ModelProfile){
  return profile.requestBytes===null?modelTransportBytes:Math.min(modelTransportBytes,profile.requestBytes);
}
export function validMediaLimits(l: MediaLimits | undefined, scope: ExecutionScope = "production"): l is MediaLimits {
  return ["production", "development-synthetic", "development-local"].includes(scope) && !!l && (scope === "production" ? l.verified === true : l.verified === false) && [l.maxFrames, l.maxPixels, l.maxDecodedBytes, l.timeoutMs, l.memoryMb].every(positive)
    && l.timeoutMs <= 15_000 && l.memoryMb <= 512 && l.maxDecodedBytes <= 128 * 1024 * 1024 && l.maxPixels <= 32_000_000 && l.maxFrames <= 300;
}
export function visualReadiness(c: VisualConfig, approvedCatalog = false, now = Date.now()): Readiness {
  const auth = !!(c.authVerified && c.authClientId && c.authSecret && c.redirectUri);
  const graph = auth && c.graphVerified;
  const model = c.processorApproved && !!c.modelKey && validProfile(c.profile, now) && validMediaLimits(c.mediaLimits);
  return {
    auth: { ready: auth, ...(!auth ? { code: "not-configured" as const } : {}) },
    context: { ready: graph, ...(!graph ? { code: "permission-denied" as const } : {}) },
    audience: { ready: graph, ...(!graph ? { code: "permission-denied" as const } : {}) },
    media: { ready: graph && validMediaLimits(c.mediaLimits), ...(!graph || !validMediaLimits(c.mediaLimits) ? { code: "media-unavailable" as const } : {}) },
    model: { ready: model, ...(!model ? { code: "model-capability-unverified" as const } : {}) },
    catalog: { ready: approvedCatalog, ...(!approvedCatalog ? { code: "asset-rights-unavailable" as const } : {}) },
    share: { ready: auth && c.shareVerified && approvedCatalog, ...(!auth || !c.shareVerified || !approvedCatalog ? { code: "share-review-required" as const } : {}) }
  };
}
