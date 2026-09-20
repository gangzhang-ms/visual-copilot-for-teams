import type {Explanation,Language} from "../shared/types";
import {useId,useState} from "react";
import {ExplanationBrief,ExplanationFullDetails} from "./ExplanationContent";
import "./inline-emoji-explanation.css";

export type InlineExplanationState =
  | {status:"idle"|"pending"|"cancelled"}
  | {status:"error";message:string}
  | {status:"ready";explanation:Explanation};
export interface InlineEmojiAnalysis {
  state:InlineExplanationState;disabled:boolean;onExplain:()=>void;onCancel:()=>void;
  kind?:"emoji"|"visual";showBackground?:boolean;
}
export function InlineEmojiExplanation({analysis,language}:{
  analysis:InlineEmojiAnalysis;language:Language;
}){
  const {state,disabled,onExplain,onCancel}=analysis,t=(en:string,zh:string)=>language==="en"?en:zh;
  const [expandedValue,setExpandedValue]=useState<Explanation>(),id=useId();
  const detailsOpen=state.status==="ready"&&expandedValue===state.explanation,visual=analysis.kind==="visual";
  return <section className="inline-emoji-explanation" aria-label={t("AI explanation for this message","这条消息的 AI 解释")} aria-busy={state.status==="pending"}>
    <p className="inline-emoji-scope">{visual?t("Scope: this message's selected visual and conversation.","范围：这条消息中所选的视觉内容及对话。"):t("Scope: this message's emoji, not only the previewed symbol.","范围：这条消息中的 emoji，而非仅当前预览的符号。")}</p>
    <div aria-live="polite" aria-atomic="true">
      {state.status==="idle"&&<p>{visual?t("Use AI to interpret this visual in the conversation.","使用 AI 结合对话解读这份视觉内容。"):t("Use AI to interpret this message's emoji in the conversation.","使用 AI 结合对话解读这条消息中的 emoji。")}</p>}
      {state.status==="pending"&&<p role="status">{t("Explaining this message…","正在解释这条消息……")}</p>}
      {state.status==="cancelled"&&<p role="status">{t("Explanation cancelled. Nothing was inserted.","解释已取消，没有插入内容。")}</p>}
      {state.status==="error"&&<p role="alert">{state.message}</p>}
      {state.status==="ready"&&<div className="inline-emoji-result">
        <ExplanationBrief value={state.explanation} language={language} showSource={analysis.showBackground}/>
      </div>}
    </div>
    <button type="button" disabled={state.status==="pending"||state.status==="ready"?false:disabled}
      aria-expanded={state.status==="ready"?detailsOpen:undefined} aria-controls={state.status==="ready"?id:undefined}
      onClick={state.status==="pending"?onCancel:state.status==="ready"?()=>setExpandedValue(detailsOpen?undefined:state.explanation):onExplain}>
      {state.status==="pending"?t("Cancel explanation","取消解释"):state.status==="ready"?t("Details","详情"):
        state.status==="error"?t("Retry AI explanation","重试 AI 解释"):t("Explain with AI","AI解释")}
    </button>
    {state.status==="ready"&&<div id={id} className="inline-explanation-details" hidden={!detailsOpen}>
      <ExplanationFullDetails value={state.explanation} language={language} emoji={!visual} showBackground={analysis.showBackground}/>
    </div>}
  </section>;
}
