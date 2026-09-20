import type {Explanation,Language} from "../shared/types";
import {text} from "./visual-i18n";
import "./explanation-panel.css";

export function ExplanationBrief({value,language,showSource=false}:{value:Explanation;language:Language;showSource?:boolean}){
  return <div className="explanation-summary">
    {showSource&&value.background.source!==null&&<p className="explanation-source"><strong>{text(language,"Source: ","出处：")}</strong>{value.background.source}</p>}
    <p className="explanation-brief inline-emoji-meaning"><strong>{text(language,"Possible meaning here: ","此处可能含义：")}</strong>{value.contextualInterpretations[0].text}</p>
  </div>;
}
function References({values,language,frames=false}:{values:readonly string[];language:Language;frames?:boolean}){
  return values.length>0?<small className="explanation-references">{frames?text(language,"Frame references: ","画面引用："):text(language,"Context references: ","上下文引用：")}{values.join(", ")}</small>:null;
}
export function ExplanationBackground({value,language,references=false}:{value:Explanation;language:Language;references?:boolean}){
  return <p className="explanation-background"><strong>{text(language,"Background: ","背景：")}</strong>{value.background.source===null
    ?text(language,"The source cannot be identified confidently from the selected visual.","无法从所选图片或表情可靠识别出处。")
    :<>{value.background.source} — {value.background.context}</>}
    {references&&<References values={value.background.frames} language={language} frames/>}</p>;
}
export function ExplanationSections({value,language,emoji=false,complete=false,references=false}:{
  value:Explanation;language:Language;emoji?:boolean;complete?:boolean;references?:boolean;
}){
  const sections=[
    [emoji?text(language,"Selected emoji","所选 emoji"):text(language,"Visible observations / uncertain OCR","可见内容 / 不确定的文字识别"),value.observations.map(o=>o.text)],
    [text(language,"Common usage","常见用法"),value.commonUsage],
    [complete?text(language,"Possible meanings in this conversation","此对话中可能的含义"):text(language,"Other possible readings","其他可能的解读"),value.contextualInterpretations.slice(complete?0:1).map(o=>o.text)],
    [text(language,"Uncertainty and missing information","不确定性与缺失信息"),value.uncertainties],
    [text(language,"Safe clarification","稳妥的澄清方式"),value.safeResponseGuidance]
  ] as const;
  return <>{sections.map(([heading,entries],section)=>entries.length>0&&<section key={heading}>
    <h3>{heading}</h3><ul>{entries.map((entry,i)=><li key={i}><span>{entry}</span>
      {references&&section===0&&<References values={value.observations[i].frames} language={language} frames/>}
      {references&&section===2&&<References values={value.contextualInterpretations[i+(complete?0:1)].context} language={language}/>}
    </li>)}</ul>
  </section>)}</>;
}
export function ExplanationFullDetails({value,language,emoji=false,showBackground=false}:{
  value:Explanation;language:Language;emoji?:boolean;showBackground?:boolean;
}){
  return <>
    {showBackground&&<ExplanationBackground value={value} language={language} references/>}
    <ExplanationSections value={value} language={language} emoji={emoji} complete references/>
  </>;
}
