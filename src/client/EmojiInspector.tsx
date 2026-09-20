import {useState} from "react";
import {emojiSequences} from "../shared/local-chat";
import {emojiIdentity} from "../catalog/emoji-identity";
import type {Language} from "../shared/types";
import {EmojiEnlargement} from "./EmojiEnlargement";
import {InlineEmojiExplanation,type InlineEmojiAnalysis} from "./InlineEmojiExplanation";
import "./emoji-inspector.css";

export function EmojiInspector({text,language,initialOpen=false,analysis}:{text:string;language:Language;initialOpen?:boolean;analysis?:InlineEmojiAnalysis}){
  const sequences=emojiSequences(text),[index,setIndex]=useState(0);
  if(!sequences.length)return null;
  const selected=Math.min(index,sequences.length-1),sequence=sequences[selected],identity=emojiIdentity(sequence,language);
  const t=(en:string,zh:string)=>language==="en"?en:zh,start=Math.floor(selected/8)*8;
  return <EmojiEnlargement className="emoji-inspector" count={sequences.length} language={language} initialOpen={initialOpen}>
      <div role="group" aria-label={t("Choose an emoji to inspect","选择要查看的 emoji")} className="emoji-inspector-choices">
        {sequences.slice(start,start+8).map((item,offset)=>{
          const position=start+offset,label=emojiIdentity(item,language);
          return <button key={position} type="button" aria-pressed={selected===position}
            aria-label={`${position+1}: ${label.known?label.name:label.codes}`} onClick={()=>setIndex(position)}><span aria-hidden="true">{item}</span></button>;
        })}
      </div>
      {sequences.length>8&&<div className="emoji-inspector-pages">
        <button type="button" disabled={start===0} onClick={()=>setIndex(start-8)}>{t("Previous emoji","上一组 emoji")}</button>
        <button type="button" disabled={start+8>=sequences.length} onClick={()=>setIndex(start+8)}>{t("Next emoji","下一组 emoji")}</button>
      </div>}
      <span className="emoji-enlarged" role="img" aria-label={`${identity.name} · ${identity.codes}`}>{sequence}</span>
      <p className="emoji-identity-name"><strong>{identity.name}</strong> · {selected+1}/{sequences.length}</p>
      <p className="emoji-codepoints">{identity.codes}</p>
      {analysis&&<InlineEmojiExplanation analysis={analysis} language={language}/>}
  </EmojiEnlargement>;
}
