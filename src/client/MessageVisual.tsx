import {useEffect,useState} from "react";
import type {LocalMessage} from "../shared/local-chat";
import type {Language} from "../shared/types";
import {EmojiEnlargement} from "./EmojiEnlargement";
import {InlineEmojiExplanation,type InlineEmojiAnalysis} from "./InlineEmojiExplanation";
import {WebPreviewQuality} from "./LocalPublicVisual";
import "./message-visual.css";

function NativePreview({src,alt,expanded,language,className=""}:{src:string;alt:string;expanded:boolean;language:Language;className?:string}){
  const [size,setSize]=useState<{src:string;width:number;height:number}>(),[failed,setFailed]=useState("");
  const [density,setDensity]=useState(()=>typeof window==="undefined"?1:Math.max(1,window.devicePixelRatio||1));
  useEffect(()=>{
    const update=()=>setDensity(Math.max(1,window.devicePixelRatio||1));
    window.addEventListener("resize",update);return()=>window.removeEventListener("resize",update);
  },[]);
  const current=size?.src===src?size:undefined;
  const width=current?Math.min(current.width/density,expanded?512:220,(expanded?640:240)*current.width/current.height):undefined;
  return <><img src={src} alt={alt} className={`message-visual-image ${className}`}
    style={{width:width??"auto",height:"auto",maxWidth:"100%"}}
    onLoad={e=>setSize({src,width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}
    onError={()=>setFailed(src)}/>
    {failed===src&&<span role="alert">{language==="en"?"This image preview could not be loaded.":"无法载入此图片预览。"}</span>}
  </>;
}
export function MessageVisual({message,language,analysis}:{message:LocalMessage;language:Language;analysis?:InlineEmojiAnalysis}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const visual=message.visual,generated=message.generated,attachment=message.attachment;
  const src=attachment?.dataUrl??generated?.posterUrl??visual?.imageUrl??visual?.animationUrl;
  const motion=attachment?.category==="gif"?attachment.dataUrl:generated?.variant==="animation"?generated.mediaUrl:visual?.animationUrl;
  const category=attachment?.category??generated?.category??visual?.category;
  const [playing,setPlaying]=useState(false);
  useEffect(()=>{
    setPlaying(false);const reduced=matchMedia("(prefers-reduced-motion: reduce)"),stop=()=>setPlaying(false);
    reduced.addEventListener("change",stop);return()=>reduced.removeEventListener("change",stop);
  },[src,motion]);
  if(!src)return null;
  const label=motion?t("Enlarge GIF","放大 GIF"):category==="sticker"?t("Enlarge sticker","放大贴纸"):t("Enlarge image","放大图片");
  const alt=generated?.alt??visual?.alt??(message.demoMedia==="user-reference"?t("Shared image","分享的图片"):t("Owned test visual","自有测试图片"));
  return <div className={`message-visual ${generated?"generated-artwork":""}`}>
    <EmojiEnlargement count={1} language={language} label={label} className="visual-enlargement"
      trigger={({open,toggle,id})=><>
        <button type="button" className="message-visual-trigger" aria-label={label} aria-expanded={open} aria-controls={id} onClick={toggle}>
          <NativePreview key={playing&&motion?motion:src} src={playing&&motion?motion:src} alt={alt} expanded={false} language={language} className={attachment?"local-upload":"local-art"}/>
        </button>
        {generated?.variant==="animation"&&<button type="button" aria-pressed={playing} onClick={()=>setPlaying(value=>!value)}>{playing?t("Stop animation","停止动画"):t("Play animation","播放动画")}</button>}
      </>}>
      <NativePreview src={motion??src} alt={alt} expanded language={language}/>
      {visual?.webSource&&<WebPreviewQuality visual={visual} size={visual.webSource.preview} language={language}/>}
      {analysis&&<InlineEmojiExplanation analysis={analysis} language={language}/>}
    </EmojiEnlargement>
    {visual?.webSource&&<WebPreviewQuality visual={visual} size={visual.webSource.preview} language={language}/>}
  </div>;
}
