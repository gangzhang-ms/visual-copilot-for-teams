import type {Language} from "../shared/types";
import type {LocalGenerationDraft,LocalReview} from "../shared/local-chat";
import {expressionStyles,type SpeakerProfile} from "../shared/expression";

export function HumanPreferences({values,language}:{values:Partial<SpeakerProfile>&{relationship?:string};language:Language}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const labels={culture:t("Culture / language context","文化 / 语言背景"),familiarity:t("Familiarity","熟悉程度"),tone:t("Tone","语气"),
    relationship:t("Relationship","关系"),humor:t("Humor","幽默"),avoid:t("Avoid","避免内容")};
  return <dl className="human-confirmation">
    {values.language&&values.language!=="unknown"&&<><dt>{t("Language","语言")}</dt><dd>{values.language==="en"?"English":"简体中文"}</dd></>}
    {(Object.keys(labels) as (keyof typeof labels)[]).filter(key=>values[key]).map(key=><div key={key}><dt>{labels[key]}</dt><dd>{values[key]}</dd></div>)}
  </dl>;
}
export function CreativeConfirmation({draft,speaker,profile,language}:{draft:LocalGenerationDraft;speaker:string;profile:SpeakerProfile|null;language:Language}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const style=expressionStyles.find(s=>s.id===draft.expression?.style);
  const intensity=draft.expression?.intensity;
  return <div className="human-confirmation">
    <h4>{t("Your creative idea","你的创作内容")}</h4>
    <p><b>{t("Creative intent","创作意图")}: </b>{draft.intent}</p>
    {draft.creative&&<p><b>{t("Creative description","创作描述")}: </b>{draft.creative}</p>}
    {style&&<p><b>{t("Expression style","表达风格")}: </b>{language==="en"?style.en:style.zh}</p>}
    {intensity&&<p><b>{t("Expression intensity","表达强度")}: </b>{intensity==="auto"?t("Follow description","跟随描述"):intensity==="restrained"?t("Restrained","克制"):intensity==="exaggerated"?t("Exaggerated","夸张"):t("Balanced","适中")}</p>}
    {draft.expression?.reference&&<p><b>{t("Reference idea","参考灵感")}: </b>{draft.expression.reference}</p>}
    <p><b>{t("Output","输出")}: </b>{draft.output==="gif"?t("Animated GIF","GIF 动图"):t("Image","图片")}</p>
    <p><b>{t("Speaker","发言者")}: </b>{speaker}</p>
    {profile&&<HumanPreferences values={profile} language={language}/>}
    <h4>{t("Audience preferences","受众偏好")}</h4><HumanPreferences values={draft.preferences} language={language}/>
    {draft.context.some(c=>c.included)&&<><h4>{t("Selected conversation context","选用的聊天上下文")}</h4>{draft.context.filter(c=>c.included).map(c=><blockquote key={c.label}>{c.text}</blockquote>)}</>}
  </div>;
}
export function AnalysisConfirmation({review,language}:{review:LocalReview;language:Language}){
  const t=(en:string,zh:string)=>language==="en"?en:zh,p=review.input.preferences;
  return <div className="human-confirmation">
    {review.input.intent&&<p><b>{t("Intent","意图")}: </b>{review.input.intent}</p>}
    {review.media.samples.length>0&&<div className="local-samples">{review.media.samples.map((f,i)=><img key={f.id} src={f.dataUrl} alt={`${t("Selected visual","所选图片")} ${i+1}`}/>)}</div>}
    {review.media.coverage.some(c=>c.mode==="sampled-stills")&&<p>{t("Some movement in this GIF may be missed.","可能遗漏 GIF 中的部分动作。")}</p>}
    <HumanPreferences values={{language:p.outputLanguage,tone:p.formality==="unknown"?"":p.formality==="formal"?t("Formal","正式"):t("Casual","轻松"),familiarity:p.familiarity,relationship:p.relationship,humor:p.humor,avoid:p.avoid}} language={language}/>
    {review.input.context.some(c=>c.included)&&<><h4>{t("Selected conversation context","选用的聊天上下文")}</h4>{review.input.context.filter(c=>c.included).map(c=><blockquote key={c.label}>{c.text}</blockquote>)}</>}
    {review.input.speakerContext&&<><h4>{t("Saved speaker preferences","已保存的发言者偏好")}: {review.profileSpeaker}</h4>
      {review.input.speakerContext.profile?<HumanPreferences values={review.input.speakerContext.profile} language={language}/>:<p>{t("No preferences saved; nothing is assumed.","未保存偏好，不作假设。")}</p>}</>}
  </div>;
}
