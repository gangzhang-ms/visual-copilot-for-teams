import { loadDevelopmentModelConfig,developmentSettings } from "./development-model";
import { loadVisualConfig,validMediaLimits, validProfile, type VisualConfig,type ModelProfile } from "./visual-config";
export function loadLocalChatConfig(key: string | undefined,ongoing=false): VisualConfig {
  if(!key?.trim())throw new Error("development-credential-unavailable");
  const config:VisualConfig = ongoing?{...loadVisualConfig({}),modelKey:key,profile:{...structuredClone(developmentSettings.profile) as ModelProfile,validUntil:null,validity:"ongoing-personal"},
    mediaLimits:structuredClone(developmentSettings.mediaLimits)}:loadDevelopmentModelConfig(key);
  config.executionScope = "development-local";
  config.syntheticRequestDigests = undefined;
  config.localRequestDigests = new Set();
  config.profile = { ...config.profile!, version:ongoing?"dev-local-open-2026-09-15-v3":"dev-local-chat-2026-09-14-v1", imageCap: 2,
    ...(ongoing?{explanationFormat:"json-schema" as const}:{}),
    requestBytes: ongoing?null:256 * 1024, inputTokens: 8500, contextTokens: 9500,
    evidence:ongoing?"Explicit ongoing personal local use, click-to-run billing, no app date/count allowance. Pinned actual developer model; not production verification."
      :"Explicit local interactive development authorization; unverified production profile. See docs/local-chat-prototype.md." };
  config.mediaLimits = { verified: false, maxFrames: 60, maxPixels: 4_000_000, maxDecodedBytes: 16_000_000, timeoutMs: 15_000, memoryMb: 128 };
  if (!validProfile(config.profile, Date.now(), config.executionScope) || !validMediaLimits(config.mediaLimits, config.executionScope)) throw new Error("local-profile-unavailable");
  return config;
}
