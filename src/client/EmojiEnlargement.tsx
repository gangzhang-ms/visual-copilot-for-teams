import {useId,useState,type ReactNode} from "react";
import type {Language} from "../shared/types";
import "./emoji-enlargement.css";

export function EmojiEnlargement({count,language,children,className="",initialOpen=false,trigger,label}:{
  count:number;language:Language;children:ReactNode;className?:string;initialOpen?:boolean;label?:string;
  trigger?:(controls:{open:boolean;toggle:()=>void;id:string})=>ReactNode;
}){
  const [open,setOpen]=useState(initialOpen),id=useId();
  return <>
    {trigger?.({open,toggle:()=>setOpen(value=>!value),id})}
    <details id={id} className={`emoji-enlargement ${className}`} open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
      <summary>{label??(language==="en"?`Enlarge emoji (${count})`:`放大 emoji（${count}）`)}</summary>
      {open&&<div className="emoji-enlargement-panel">{children}</div>}
    </details>
  </>;
}
