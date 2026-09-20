import {useEffect,useState} from "react";
import {emptySpeakerProfile,type SpeakerProfile} from "../shared/expression";
import type {LocalState} from "../shared/local-chat";
import type {Language} from "../shared/types";

export function SpeakerProfileEditor({room,speaker,role,language,busy,onDirty,onSave}:{room:LocalState;speaker:string;role:"sender"|"outgoing";language:Language;busy:boolean;onDirty:(dirty:boolean)=>void;onSave:(profile:SpeakerProfile|null)=>Promise<void>}){
  const stored=room.speakerProfiles?.find(p=>p.speaker===speaker)?.profile,serialized=JSON.stringify(stored??null);
  const [draft,setDraft]=useState<SpeakerProfile>(stored??emptySpeakerProfile()),[dirty,setDirty]=useState(false);
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  useEffect(()=>{setDraft(stored??emptySpeakerProfile());setDirty(false);onDirty(false);},[speaker,serialized]);
  function edit(value:Partial<SpeakerProfile>){setDraft(p=>({...p,...value}));setDirty(true);onDirty(true);}
  return <details className="speaker-profile"><summary>{role==="sender"?t("Selected sender profile","所选消息发言者偏好"):t("Outgoing speaker profile","当前发言者偏好")}: <strong>{speaker||"—"}</strong> · {stored?t("self-reported","自愿填写"):t("unknown","未知")}</summary>
    <p>{t("Optional, for this simulated speaker only. Language is not ethnicity or culture. Nothing is inferred from a name; audience/requester preferences stay separate. Saved only in this memory session.","可选，仅用于这位模拟发言者。语言不等于族裔或文化，不根据姓名推断；受众／请求者偏好单独填写。仅保存在本次内存会话中。")}</p>
    <label>{t("Profile language","偏好使用的语言")}<select aria-label={t("Profile language","偏好使用的语言")} value={draft.language} onChange={e=>edit({language:e.target.value as SpeakerProfile["language"]})}>
      <option value="unknown">{t("Unknown / unspecified","未知／未填写")}</option><option value="zh-CN">简体中文</option><option value="en">English</option>
    </select></label>
    {(["culture","familiarity","tone","humor","avoid"] as const).map((key,i)=><label key={key}>{t(
      ["Voluntary cultural context","Online-community familiarity","Speaker tone","Speaker humor","Sensitive topics / avoid"][i],
      ["自愿提供的文化背景","网络社群／表达习惯","发言语气","幽默偏好","敏感话题／避免内容"][i])}
      <input maxLength={200} value={draft[key]} onChange={e=>edit({[key]:e.target.value})}/></label>)}
    {dirty&&<p role="status">{t("Unsaved profile changes. Save or discard before preparing AI.","偏好尚未保存，请先保存或放弃修改，再准备 AI 请求。")}</p>}
    <button disabled={busy||!dirty||!speaker.trim()} onClick={()=>void onSave(draft)}>{t("Save speaker profile","保存发言者偏好")}</button>
    <button disabled={busy||!stored} onClick={()=>void onSave(null)}>{t("Remove speaker profile","移除发言者偏好")}</button>
    {dirty&&<button disabled={busy} onClick={()=>{setDraft(stored??emptySpeakerProfile());setDirty(false);onDirty(false);}}>{t("Discard profile edits","放弃偏好修改")}</button>}
  </details>;
}
