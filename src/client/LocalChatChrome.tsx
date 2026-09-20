import { useEffect,useRef,useState,type KeyboardEvent,type ReactNode } from "react";
const paths={
  chat:"M4 4h16v12H9l-5 4V4m4 4h8m-8 4h5", search:"M15 15l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  sparkle:"m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3",
  image:"M3 4h18v16H3V4m0 12 5-5 4 4 3-3 6 6M15 8h.01",
  menu:"M4 6h16M4 12h16M4 18h16",close:"m6 6 12 12M6 18 18 6",send:"m3 3 19 9-19 9 4-9-4-9m4 9h15",
  clip:"m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8",
  smile:"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 9h.01M16 9h.01M8 14q4 5 8 0",
  more:"M5 12h.01M12 12h.01M19 12h.01",arrow:"m9 5 7 7-7 7",edit:"m4 16 12-12 4 4-12 12H4v-4m9-9 4 4",
  trash:"M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6",
};
export function ChatIcon({name}:{name:keyof typeof paths}){
  return <svg className="chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
export function containFocus(event:KeyboardEvent<HTMLElement>){
  if(event.key!=="Tab")return;
  const items=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')]
    .filter(e=>!e.closest("[hidden]")&&e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden");
  const first=items[0],last=items.at(-1);
  if(!first){event.preventDefault();return;}
  if(event.shiftKey&&(document.activeElement===first||!items.includes(document.activeElement as HTMLElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
export function MessageActions({language,busy,canEdit,canExplain,onExplain,onEdit,onRemove,mediaInfo}:{language:"en"|"zh-CN";busy:boolean;canEdit:boolean;canExplain:boolean;onExplain:()=>void;onEdit:()=>void;onRemove:()=>void;mediaInfo?:ReactNode}){
  const [open,setOpen]=useState(false),[above,setAbove]=useState(false);
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const info=useRef<HTMLDialogElement>(null);
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const close=(restore=true)=>{setOpen(false);if(restore)trigger.current?.focus();};
  useEffect(()=>{
    if(!open)return;
    const area=root.current?.closest(".local-messages")?.getBoundingClientRect(),position=trigger.current?.getBoundingClientRect();
    setAbove(!!area&&!!position&&area.bottom-position.bottom<160);
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside=(e:PointerEvent)=>{if(e.target instanceof Node&&!root.current?.contains(e.target))close(false);};
    document.addEventListener("pointerdown",outside);return()=>document.removeEventListener("pointerdown",outside);
  },[open]);
  const act=(run:()=>void)=>{close(false);run();};
  return <><div className="local-message-actions" ref={root}>
    {canExplain&&<button disabled={busy} onClick={e=>{if(e.detail<=1)onExplain();}}><ChatIcon name="sparkle"/>{t("Explain","解释一下")}</button>}
    <button className="message-direct-edit" aria-label={t("Edit","编辑")} title={t("Edit","编辑")} disabled={busy||!canEdit} onClick={onEdit}><ChatIcon name="edit"/></button>
    <button className="message-direct-remove" aria-label={t("Remove","删除")} title={t("Remove","删除")} disabled={busy} onClick={onRemove}><ChatIcon name="trash"/></button>
    <button ref={trigger} aria-label={t("Message actions","消息操作")} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(v=>!v)}
      onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();setOpen(true);}if(e.key==="Escape"){e.stopPropagation();close();}}}><ChatIcon name="more"/></button>
    {open&&<div className={`message-menu ${above?"above":""}`} role="menu" aria-label={t("Message actions","消息操作")} ref={menu} onKeyDown={e=>{
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();return;}
      if(e.key==="Tab"){close(false);return;}
      if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){
        e.preventDefault();const items=[...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")],at=items.indexOf(document.activeElement as HTMLButtonElement);
        items[e.key==="Home"?0:e.key==="End"?items.length-1:(at+(e.key==="ArrowDown"?1:-1)+items.length)%items.length]?.focus();
      }
    }}>
      {canExplain&&<button role="menuitem" disabled={busy} onClick={e=>{if(e.detail<=1)act(onExplain);}}><ChatIcon name="sparkle"/>{t("Explain this message","解释这条消息")}</button>}
      <button role="menuitem" disabled={busy||!canEdit} onClick={()=>act(onEdit)}><ChatIcon name="edit"/>{t("Edit message","编辑消息")}</button>
      <button role="menuitem" disabled={busy} onClick={()=>act(onRemove)}><ChatIcon name="trash"/>{t("Remove message","删除消息")}</button>
      {mediaInfo&&<button role="menuitem" onClick={()=>act(()=>info.current?.showModal())}><ChatIcon name="image"/>{t("Media information","素材信息")}</button>}
    </div>}
  </div>
    {mediaInfo&&<dialog ref={info} className="local-media-info" aria-label={t("Media information","素材信息")}
      onClose={()=>trigger.current?.focus()} onKeyDown={e=>{if(e.key==="Escape")e.stopPropagation();}}>
      <header><h3>{t("Media information","素材信息")}</h3><button type="button" onClick={()=>info.current?.close()}>{t("Close","关闭")}</button></header>
      {mediaInfo}
    </dialog>}
  </>;
}
