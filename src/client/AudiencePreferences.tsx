import type { AudiencePreferences as Preferences, Language } from "../shared/types";
import { initialPreferences, text } from "./visual-i18n";
export function AudiencePreferences({ value, language, change }: { value: Preferences; language: Language; change: (v: Preferences) => void }) {
  const fields = [["familiarity", "Reference familiarity", "对相关典故的熟悉程度"], ["relationship", "Relationship", "与受众的关系"], ["humor", "Humor preference", "幽默偏好"], ["avoid", "Topics to avoid", "避免的话题"]] as const;
  return <section className="panel"><h2>{text(language, "Voluntary audience preferences", "自愿提供的受众偏好")}</h2>
    <p>{text(language, "Reported by you, unverified and unknown by default. Names, appearance, region and membership are not cultural profiles.", "由你提供，未经验证；默认为未知。姓名、外貌、地区和成员身份不代表文化特征。")}</p>
    {fields.map(([key, en, zh]) => <label key={key}>{text(language, en, zh)}<input value={value[key]} maxLength={300} onChange={e => change({ ...value, [key]: e.target.value, confirmed: false })} /></label>)}
    <label>{text(language, "Formality", "正式程度")}<select value={value.formality} onChange={e => change({ ...value, formality: e.target.value as Preferences["formality"], confirmed: false })}>
      <option value="unknown">{text(language, "Unknown", "未知")}</option><option value="formal">{text(language, "Formal", "正式")}</option><option value="casual">{text(language, "Casual", "轻松")}</option>
    </select></label>
    <label>{text(language, "Output language (explicit choice)", "输出语言（明确选择）")}<select value={value.outputLanguage} onChange={e => change({ ...value, outputLanguage: e.target.value as Language, confirmed: false })}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
    <label><input type="checkbox" checked={value.confirmed} onChange={e => change({ ...value, confirmed: e.target.checked })} />{text(language, "I confirm these voluntary preferences and output language.", "我确认以上自愿提供的偏好和输出语言。")}</label>
    <button onClick={() => change(initialPreferences())}>{text(language, "Remove preferences", "移除偏好")}</button>
  </section>;
}
