import type {Language,PublicVisual} from "../shared/types";
import {useEffect,useRef,useState} from "react";
export function PublicNotices({visual,language}:{visual:PublicVisual;language:Language}){
  return <>{visual.template&&<p className="local-muted">{visual.notices.source} · {language==="en"?"Uncaptioned template · external redistribution rights not verified":"未配字模板 · 对外再分发权利未核实"}</p>}<details className="local-notices"><summary>{language==="en"?"Source & local-use notices":"来源与本地使用说明"}</summary>
    <p>{visual.notices.source}</p><p>{visual.notices.creator}</p><p>{visual.notices.license}</p>
    {visual.webSource&&<><p>{visual.webSource.provider==="Google Images via SerpApi"?(language==="en"?"Google Images via SerpApi thumbnail, not AI-generated or an official Google API. Original creator/license unverified; no Commons license is implied.":"通过 SerpApi 获取的 Google 图片缩略图，非 AI 生成，也非 Google 官方 API。原作者和许可未核实，不适用维基许可假设。"):visual.webSource.provider==="Wikimedia Commons"?(language==="en"?"Wikimedia Commons thumbnail, not AI-generated. Shared media library, not whole-web search; check this file's attribution and license.":"维基共享资源缩略图，非 AI 生成。共享素材库而非全网搜索；请检查本文件的署名与许可。"):(language==="en"?"Brave-proxied web preview, not the full-resolution original or AI-generated artwork.":"Brave 代理的网络预览图，并非全分辨率原图，也不是 AI 生成作品。")}</p>
      <p>{language==="en"?"Search terms":"搜索词"}: {visual.webSource.query}</p></>}
    {visual.notices.text.map((v,i)=><p key={i}>{v}</p>)}
    {visual.notices.links.map(l=><a key={l.url} href={l.url} rel="noreferrer" target="_blank">{l.label}</a>)}</details></>;
}
export function PublicArtwork({visual,animate=false,language="en"}:{visual:PublicVisual;animate?:boolean;language?:Language}){
  if(visual.webSource)return <WebArtwork visual={visual} language={language}/>;
  return <img className="local-art" src={animate&&visual.animationUrl?visual.animationUrl:visual.imageUrl} alt={visual.alt}/>;
}
function WebArtwork({visual,language}:{visual:PublicVisual;language:Language}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const [open,setOpen]=useState(false),[loaded,setLoaded]=useState<{width:number;height:number}>();
  const [density,setDensity]=useState(()=>typeof window==="undefined"?1:Math.max(1,window.devicePixelRatio||1));
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const size=visual.webSource?.preview??loaded;
  useEffect(()=>{
    const update=()=>setDensity(Math.max(1,window.devicePixelRatio||1));
    window.addEventListener("resize",update);return()=>window.removeEventListener("resize",update);
  },[]);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  return <div className="public-web-artwork">
    <img className="local-art public-web-art" src={visual.imageUrl} alt={visual.alt}
      onLoad={e=>setLoaded({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}
      style={{width:size?size.width/density:"auto",height:"auto",maxWidth:"min(100%, 220px)"}}/>
    <WebPreviewQuality visual={visual} size={size} language={language}/>
    <button ref={trigger} type="button" disabled={!size} onClick={()=>setOpen(true)}>{t("Inspect downloaded pixels","查看下载图像素")}</button>
    {open&&<dialog ref={dialog} className="local-web-preview" aria-label={t("Downloaded image preview","下载图片预览")}
      onClose={()=>{setOpen(false);trigger.current?.focus();}} onKeyDown={e=>{if(e.key==="Escape")e.stopPropagation();}}>
      <header><h3>{t("Downloaded thumbnail, not a high-resolution original","已下载缩略图，非高清原图")}</h3>
        <button type="button" onClick={()=>dialog.current?.close()}>{t("Close","关闭")}</button></header>
      <p>{t("No enlargement or sharpening. If this is still unclear, use another image or inspect its source page.","未放大或锐化。若仍看不清，请换图或查看来源页面。")}</p>
      {visual.webSource?.preview&&<p>{t("Downloaded / retained pixels","下载 / 保留像素")}: {visual.webSource.preview.downloadWidth}×{visual.webSource.preview.downloadHeight} / {size?.width}×{size?.height}</p>}
      <img src={visual.imageUrl} alt={visual.alt} style={{width:size?size.width/density:"auto",maxWidth:"100%",height:"auto"}}/>
    </dialog>}
  </div>;
}
export function WebPreviewQuality({visual,size,language}:{visual:PublicVisual;size?:{width:number;height:number};language:Language}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const small=size&&(Math.max(size.width,size.height)<320||Math.min(size.width,size.height)<180);
  return <><p className="web-preview-quality">{small?t("Small thumbnail: fine details may be unreadable. Enlarging cannot restore them.","小尺寸缩略图：细节可能看不清，放大不能恢复细节。"):t("Search thumbnail; source blur or overlapping faces cannot be repaired here.","搜索缩略图；原图的模糊或叠影无法在这里修复。")}
    {size&&<> {size.width}×{size.height} {t("available pixels","可用像素")}</>}</p>
    {visual.webSource?.preview&&(visual.webSource.preview.downloadWidth>visual.webSource.preview.width||visual.webSource.preview.downloadHeight>visual.webSource.preview.height)&&
      <p className="web-preview-quality">{t("Reduced locally to stay within image safety limits; some detail was lost.","为遵守图片安全限制已在本地缩小，部分细节已丢失。")}</p>}
  </>;
}
