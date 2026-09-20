import type { Language } from "../shared/types";
export const text = (language: Language, en: string, zh: string) => language === "zh-CN" ? zh : en;
export const initialPreferences = () => ({
  source: "requester-reported" as const, confirmed: false, outputLanguage: "en" as Language,
  familiarity: "", formality: "unknown" as const, relationship: "", humor: "", avoid: ""
});
