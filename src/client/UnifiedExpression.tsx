import type {AudiencePreferences,ContextSnippet,Language} from "../shared/types";
import type {LocalGenerationDraft} from "../shared/local-chat";
import {LOCAL_CONTEXT_LIMIT} from "../shared/local-context";
export interface ExpressionDraft {
  intent:string;context:ContextSnippet[];loaded:boolean;version:number;
  preferences:Pick<AudiencePreferences,"formality"|"familiarity"|"relationship"|"humor"|"avoid">;
}
export const emptyExpression=():ExpressionDraft=>({intent:"",context:[],loaded:false,version:0,
  preferences:{formality:"unknown",familiarity:"",relationship:"",humor:"",avoid:""}});
export const emptyCreativeDraft=(language:Language):LocalGenerationDraft=>({intent:"",creative:"",output:"image",context:[],
  expression:{style:"auto",intensity:"auto",reference:""},
  preferences:{source:"requester-reported",language,culture:"",familiarity:"",tone:"",relationship:"",humor:"",avoid:""}});
export function sharedCreativeDraft(options:LocalGenerationDraft,common:ExpressionDraft,language:Language):LocalGenerationDraft{
  const {formality,...preferences}=common.preferences;
  return {...options,intent:common.intent,context:common.context.map(({label,text,included})=>({label,text,included})),
    preferences:{...options.preferences,...preferences,language,tone:formality==="unknown"?"":formality==="formal"?"Formal":"Casual"}};
}
export function UnifiedExpression({value,creating,language,disabled,onChange,onMode,onReload,emoji=false}:{
  value:ExpressionDraft;creating:boolean;language:Language;disabled:boolean;
  onChange:(change:Partial<ExpressionDraft>)=>void;onMode:(creating:boolean)=>void;onReload:()=>void;
  emoji?:boolean;
}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  return <section aria-label={t("Your expression","你的表达")} className="unified-expression">
    <label>{t("What would you like to express?","你想表达什么？")}<textarea aria-label={t("What would you like to express?","你想表达什么？")} maxLength={2000} value={value.intent}
      placeholder={!emoji&&creating?t("e.g. Sherlock Holmes looking pleased after solving a problem","例如：福尔摩斯发现问题后的得意表情，用来庆祝排查成功"):undefined}
      onChange={e=>onChange({intent:e.target.value})} disabled={disabled}/></label>
    {!emoji&&<fieldset disabled={disabled}><legend>{t("Choose how","选择表达方式")}</legend>
      <label><input type="radio" name="expression-mode" checked={!creating} onChange={()=>onMode(false)}/>{t("Find an existing image","推荐现成图")}</label>
      <label><input type="radio" name="expression-mode" checked={creating} onChange={()=>onMode(true)}/>{t("Create a new image","生成新图")}</label>
    </fieldset>}
    {!emoji&&<p className="local-muted">{creating?t("For a movie character, include the film title or character's name.","想用电影角色时，写上片名或角色名。"):
      t("Choose from three existing images. Internet templates are usually static and can have a local caption.","从三个现成图片中选择。网络模板通常为静态图，      可另加配文。")}</p>}
    {(emoji||!creating)&&<ExpressionPreferences value={value} language={language} disabled={disabled} onChange={onChange} onReload={onReload}/>}
  </section>;
}
export function ExpressionPreferences({value,language,disabled,onChange,onReload}:{
  value:ExpressionDraft;language:Language;disabled:boolean;onChange:(change:Partial<ExpressionDraft>)=>void;onReload:()=>void;
}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  return <details className="studio-preferences"><summary>{t("Audience preferences & context","受众偏好与上下文")}</summary>
      <p>{t("These choices apply to either way of expressing yourself. They are separate from the saved speaker preferences.","这些选择对两种表达方式通用，与已保存的发言者偏好分开。")}</p>
      <label>{t("Tone preference","语气偏好")}<select aria-label={t("Tone preference","语气偏好")} disabled={disabled} value={value.preferences.formality} onChange={e=>onChange({preferences:{...value.preferences,formality:e.target.value as AudiencePreferences["formality"]}})}>
        <option value="unknown">{t("Unknown / no assumption","未知 / 不作假设")}</option><option value="formal">{t("Formal","正式")}</option><option value="casual">{t("Casual","轻松")}</option></select></label>
      {(["familiarity","relationship","humor","avoid"] as const).map((key,i)=><label key={key}>{t(["Familiarity","Relationship","Humor","Avoid"][i],["熟悉程度","关系","幽默","避免内容"][i])}
        <input maxLength={300} disabled={disabled} value={value.preferences[key]} onChange={e=>onChange({preferences:{...value.preferences,[key]:e.target.value}})}/></label>)}
      <h4>{t("Context you choose","你选择的上下文")}</h4>
      <p>{t(`Select at most ${LOCAL_CONTEXT_LIMIT} messages; the rest of your conversation is kept.`,`最多选择 ${LOCAL_CONTEXT_LIMIT} 条消息，其余聊天记录仍会保留。`)}</p>
      <button type="button" disabled={disabled} onClick={onReload}>{t("Reload current message text","重新载入当前消息文字")}</button>
      {value.context.map((c,i)=><div className="local-context-row" key={c.label}>
        <input type="checkbox" disabled={disabled} aria-label={`${t("Include context","包含上下文")} ${i+1}`} checked={c.included}
          onChange={e=>onChange({context:value.context.map(x=>x.label===c.label?{...x,included:e.target.checked}:x)})}/>
        <textarea maxLength={2000} disabled={disabled||!c.included} aria-label={`${t("Context","上下文")} ${i+1}`} value={c.text}
          onChange={e=>onChange({context:value.context.map(x=>x.label===c.label?{...x,text:e.target.value}:x)})}/>
        <button type="button" disabled={disabled} aria-label={`${t("Remove context","移除上下文")} ${i+1}`} onClick={()=>onChange({context:value.context.filter(x=>x.label!==c.label)})}>×</button>
      </div>)}
    </details>;
}
