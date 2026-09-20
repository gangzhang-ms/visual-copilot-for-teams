import type { Explanation, Language } from "../shared/types";
import { text } from "./visual-i18n";
import "./explanation-panel.css";
import {EmojiInspector} from "./EmojiInspector";
import {ExplanationBrief,ExplanationFullDetails} from "./ExplanationContent";
export function ExplanationPanel({ value, language,emoji }: { value: Explanation; language: Language;emoji?:string }) {
  return <section className="panel explanation-panel"><h2>{text(language, "Possible meaning", "可能的含义")}</h2>
    {emoji&&<><EmojiInspector key={emoji} text={emoji} language={language}/>
      <p className="inline-emoji-scope">{text(language,"Scope: this message's emoji, not only the previewed symbol.","范围：这条消息中的 emoji，而非仅当前预览的符号。")}</p></>}
    <ExplanationBrief value={value} language={language} showSource={!emoji}/>
    <details key={JSON.stringify([value,language])} className="explanation-details">
      <summary>{text(language, "Details", "详情")}</summary>
      <ExplanationFullDetails value={value} language={language} emoji={!!emoji} showBackground={!emoji}/>
    </details></section>;
}
