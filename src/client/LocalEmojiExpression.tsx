import {useEffect,useRef,useState} from "react";
import type {Language} from "../shared/types";
import type {LocalState} from "../shared/local-chat";
import type {EmojiExpressionDraft,EmojiSuggestions} from "../shared/emoji-expression";
import {emojiInsertion} from "../shared/emoji-expression";
import type {ExpressionDraft} from "./UnifiedExpression";
import {localRequest,beginLocalWork,ensureLocalSpeaker} from "./local-chat-api";
import {friendlyLocalError} from "./friendly-local-error";
export function LocalEmojiExpression({room,common,language,replyTo,blocked,speaker,onReply,onState,onWork,onInsert}:{
  room:LocalState;common:ExpressionDraft;language:Language;replyTo:string|null;blocked:boolean;
  speaker:string;
  onReply:(id:string|null)=>void;onState:(state:LocalState)=>void;onWork:()=>void;onInsert:(text:string)=>void;
}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const [suggestions,setSuggestions]=useState<EmojiSuggestions>(),[selected,setSelected]=useState<number>();
  const [withText,setWithText]=useState(false),[running,setRunning]=useState(false),[error,setError]=useState(""),[inserted,setInserted]=useState(false);
  const controller=useRef<AbortController|undefined>(undefined),epoch=useRef(0),flight=useRef(false),alive=useRef(true),acceptedRevision=useRef(room.revision);
  const signature=JSON.stringify([common,language,replyTo]),signatureRef=useRef(signature);signatureRef.current=signature;
  function cancel(){epoch.current++;controller.current?.abort();setSuggestions(undefined);setSelected(undefined);setInserted(false);}
  useEffect(()=>{cancel();setError("");},[signature]);
  useEffect(()=>{if(room.revision!==acceptedRevision.current)cancel();acceptedRevision.current=room.revision;},[room.revision]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;controller.current?.abort();};},[]);
  const fresh=(id:number,sig:string)=>alive.current&&epoch.current===id&&signatureRef.current===sig;
  async function run(){
    if(flight.current)return;
    const finish=beginLocalWork();
    cancel();const id=epoch.current,sig=signatureRef.current,c=new AbortController();controller.current=c;
    flight.current=true;setRunning(true);setError("");onWork();
    try{
      let current=await localRequest<LocalState>("state",{},c.signal);
      if(!fresh(id,sig))return;
      current=await ensureLocalSpeaker(current,speaker,c.signal);
      if(!fresh(id,sig))return;
      acceptedRevision.current=current.revision;onState(current);
      const draft:EmojiExpressionDraft={intent:common.intent,language,replyTo,preferences:common.preferences,
        context:common.context.map(({label,text,included})=>({label,text,included}))};
      const value=await localRequest<{suggestions:EmojiSuggestions;state:LocalState}>("emoji/suggest",{revision:current.revision,draft},c.signal);
      if(!fresh(id,sig))return;
      acceptedRevision.current=value.state.revision;onState(value.state);setSuggestions(value.suggestions);
    }catch(e){
      if(fresh(id,sig)&&!c.signal.aborted)setError(e instanceof Error?e.message:"model-provider-unavailable");
    }finally{
      flight.current=false;
      if(alive.current){
        setRunning(false);
        try{const current=await localRequest<LocalState>("state");if(alive.current){
          if(current.revision!==acceptedRevision.current)cancel();
          acceptedRevision.current=current.revision;onState(current);
        }}
        catch(e){if(fresh(id,sig))setError(e instanceof Error?e.message:"auth-required");}
      }
      finish();
    }
  }
  async function insert(){
    if(!suggestions||selected===undefined||flight.current)return;
    const finish=beginLocalWork();
    const id=epoch.current,sig=signatureRef.current,c=new AbortController();controller.current=c;flight.current=true;setRunning(true);setError("");
    try{
      const value=await localRequest<{text:string}>("emoji/selection",{revision:suggestions.revision,id:suggestions.id,
        digest:suggestions.digest,index:selected,withText},c.signal);
      if(!fresh(id,sig))return;
      onInsert(value.text);setSuggestions(undefined);setSelected(undefined);setInserted(true);
    }catch(e){if(fresh(id,sig)&&!c.signal.aborted)setError(e instanceof Error?e.message:"processing-review-required");}
    finally{finish();flight.current=false;if(alive.current)setRunning(false);}
  }
  return <section className="emoji-expression" aria-label={t("Emoji expression","Emoji 表达")}>
    <p>{t("Unicode text only. Uses selected message text and emoji, not picture pixels. No image search or generation.","仅生成 Unicode 文字表情，使用所选消息的文字和 emoji，不分析图片像素，也不搜索或生成图片。")}</p>
    <label>{t("Reply to message","回复哪条消息")}<select aria-label={t("Reply to message","回复哪条消息")} value={replyTo??""}
      onChange={e=>{cancel();onReply(e.target.value||null);}}>
      <option value="">{t("Conversation context (no specific target)","结合对话（不指定消息）")}</option>
      {room.messages.map(m=><option key={m.id} value={m.id}>{m.speaker}: {m.text.slice(0,100)||t("Image message","图片消息")}</option>)}
    </select></label>
    {error&&<p role="alert">{error==="emoji-composer-limit"?t("Your draft would exceed 2000 characters. Shorten it first; nothing was replaced.","加入后会超过 2000 字符。请先缩短草稿；原内容未被替换。"):
      error==="emoji-editing"?t("Finish editing the existing message first.","请先完成现有消息的编辑。"):friendlyLocalError(error,language)}</p>}
    <button className="local-primary" disabled={blocked||running||!common.intent.trim()} onClick={()=>void run()}>{t("Suggest emoji","推荐 emoji")}</button>
    {running&&<><p role="status">{t("Preparing emoji suggestions…","正在准备 emoji 建议……")}</p><button onClick={cancel}>{t("Cancel emoji request","取消 emoji 请求")}</button></>}
    {suggestions&&<div className="emoji-options">{suggestions.options.map((o,i)=><article key={i}>
      <h3>{o.label}</h3><p className="emoji-choice" aria-label={o.label}>{o.emojis.join("")}</p>
      <p>{o.reason}</p><p className="local-muted">{o.caution}</p>{o.text&&<p>{t("Optional text: ","可选配文：")}{o.text}</p>}
      <button disabled={running||blocked} aria-pressed={selected===i} onClick={()=>{setSelected(i);setWithText(false);}}>{t(`Choose option ${i+1}`,`选择方案 ${i+1}`)}</button>
    </article>)}</div>}
    {suggestions&&selected!==undefined&&<section aria-label={t("Emoji insertion preview","Emoji 插入预览")}>
      <label><input type="checkbox" checked={withText} disabled={running} onChange={e=>setWithText(e.target.checked)}/>{t("Include accompanying text","附加配文")}</label>
      <p className="emoji-insertion">{emojiInsertion(suggestions.options[selected],withText)}</p>
      <p>{t("Adds to your current draft; attachments stay. Review and Send yourself.","加入当前输入框，保留附件。请自行检查并发送。")}</p>
      <button disabled={running||blocked} onClick={()=>void insert()}>{t("Insert into composer","插入输入框")}</button>
    </section>}
    {inserted&&<p role="status">{t("Added to your draft. Nothing was sent.","已加入输入框，尚未发送。")}</p>}
  </section>;
}
