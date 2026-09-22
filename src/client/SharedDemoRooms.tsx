import {useState} from "react";
import type {Language} from "../shared/types";
import {demoRoomUrl,validDemoChatId} from "../shared/demo-room";

export function SharedDemoRooms({chatId,expiresAt,language="en"}:{chatId?:string;expiresAt?:number;language?:Language}){
  const [entry,setEntry]=useState(chatId??""),[error,setError]=useState(""),[copied,setCopied]=useState(false);
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const share=chatId?`${window.location.origin}${demoRoomUrl(chatId)}`:"";
  async function copy(){
    setCopied(false);
    if(!navigator.clipboard){setError(t("Copy is unavailable. Select the Share URL field manually.","无法自动复制，请手动选中共享链接。"));return;}
    try{await navigator.clipboard.writeText(share);setCopied(true);setError("");}
    catch{setError(t("Could not copy. Select and copy the Share URL field manually.","复制失败，请手动选中并复制共享链接。"));}
  }
  return <section className="shared-demo-rooms" aria-label={t("Shared demo room","共享演示房间")}>
    <h2>{t("Shared demo rooms","共享演示房间")}</h2>
    {chatId&&<p>{t("Current Chat ID: ","当前 Chat ID：")}<strong>{chatId}</strong></p>}
    <p role="note"><strong>{t("Anyone knowing the Chat ID can read, change or clear this demo room. No login or membership checks. Do not use sensitive content.",
      "知道 Chat ID 的任何人都能查看、修改或清空此演示房间。不验证登录或成员身份。请勿使用敏感内容。")}</strong></p>
    <p>{t("Local computer only (127.0.0.1). Joining and refresh do not call AI; AI buttons can incur charges.",
      "仅限本机（127.0.0.1）。加入和刷新不会调用 AI；点击 AI 按钮可能产生费用。")}</p>
    <form onSubmit={event=>{
      event.preventDefault();setError("");setCopied(false);
      if(!validDemoChatId(entry)){setError(t("Use 1–64 ASCII letters, digits, underscores or hyphens. IDs are case-sensitive.","请输入 1–64 位 ASCII 字母、数字、下划线或连字符；ID 区分大小写。"));return;}
      if(entry===chatId)return;
      if(chatId&&!window.confirm(t("Switch demo rooms? Unsent drafts and previews in this tab will be discarded. The previous room stays available to others.",
        "切换演示房间？本标签页未发送的草稿和预览将被丢弃。其他人仍可使用原房间。")))return;
      window.location.assign(demoRoomUrl(entry));
    }}>
      <label>{t("Chat ID","Chat ID")}<input aria-label="Chat ID" value={entry} maxLength={64} autoComplete="off" spellCheck={false}
        onChange={event=>{setEntry(event.target.value);setError("");}}/></label>
      <button type="submit">{chatId?t("Switch / join Chat ID","切换／加入 Chat ID"):t("Create / join Chat ID","创建／加入 Chat ID")}</button>
    </form>
    {chatId&&<>
      <label>{t("Share URL","共享链接")}<input aria-label={t("Share URL","共享链接")} readOnly value={share}/></label>
      <button onClick={()=>void copy()}>{t("Copy share URL","复制共享链接")}</button>
      {copied&&<p role="status">{t("Share URL copied.","已复制共享链接。")}</p>}
      {expiresAt&&<p>{t("Room expires at ","房间到期时间：")}{new Date(expiresAt).toLocaleTimeString(language)}
        {t(" (30 minutes after creation; joining does not extend it).","（创建后 30 分钟；再次加入不会延长）。")}</p>}
    </>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
