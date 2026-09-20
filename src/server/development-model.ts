import settings from "../../config/visual-model.development.json";
import { loadVisualConfig, validMediaLimits, validProfile, type VisualConfig, type ModelProfile } from "./visual-config";

export const developmentSettings = settings;
export function loadDevelopmentModelConfig(key: string | undefined): VisualConfig {
  if (!key?.trim()) throw new Error("development-credential-unavailable");
  const config: VisualConfig = {
    ...loadVisualConfig({}), modelKey: key, executionScope: "development-synthetic",
    profile: structuredClone(settings.profile) as ModelProfile,
    mediaLimits: structuredClone(settings.mediaLimits), syntheticRequestDigests: new Set()
  };
  if (!validProfile(config.profile, Date.now(), config.executionScope) || !validMediaLimits(config.mediaLimits, config.executionScope)) {
    throw new Error("development-capability-expired-or-invalid");
  }
  return config;
}
