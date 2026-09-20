import {useEffect,useRef,useState} from "react";
export interface ComposerAttachment {base64:string;mime:string;category:string}
export function useComposerAttachment(blocked:()=>boolean){
  const [attachment,setAttachment]=useState<ComposerAttachment>(),[reading,setReading]=useState(false),[error,setError]=useState("");
  const epoch=useRef(0),reader=useRef<FileReader|undefined>(undefined),image=useRef<HTMLImageElement|undefined>(undefined);
  function cancelRead(){
    epoch.current++;reader.current?.abort();reader.current=undefined;
    if(image.current){image.current.onload=null;image.current.onerror=null;image.current.src="";image.current=undefined;}
    setReading(false);
  }
  function clear(){cancelRead();setAttachment(undefined);setError("");}
  useEffect(()=>()=>{epoch.current++;reader.current?.abort();if(image.current){image.current.onload=null;image.current.onerror=null;image.current.src="";}},[]);
  function ingest(files:File[]){
    cancelRead();setError("");
    if(blocked()){setError("attachment-blocked");return;}
    if(files.length!==1){setError("attachment-count");return;}
    const file=files[0];
    if(file.size>1024*1024){setError("attachment-size");return;}
    if(!file.size||!["image/png","image/jpeg","image/gif"].includes(file.type)){setError("unsupported-format");return;}
    const ticket=epoch.current,active=()=>ticket===epoch.current;
    const fail=(code:string)=>{if(active()){setReading(false);setError(code);}};
    const next=new FileReader();reader.current=next;setReading(true);
    next.onerror=()=>fail("attachment-read");
    next.onload=()=>{
      if(!active())return;
      const url=next.result;
      if(typeof url!=="string"||!url.startsWith(`data:${file.type};base64,`)){fail("attachment-read");return;}
      const preview=new Image();image.current=preview;
      preview.onerror=()=>fail("unsupported-format");
      preview.onload=()=>{
        if(!active())return;
        if(!preview.naturalWidth||!preview.naturalHeight||preview.naturalWidth*preview.naturalHeight>4_000_000){fail("attachment-pixels");return;}
        setAttachment({base64:url.slice(url.indexOf(",")+1),mime:file.type,category:file.type==="image/gif"?"gif":"image"});
        setReading(false);setError("");image.current=undefined;reader.current=undefined;
      };
      preview.src=url;
    };
    try{next.readAsDataURL(file);}catch{fail("attachment-read");}
  }
  return {attachment,reading,error,ingest,clear,cancelRead,report:setError,
    category:(category:string)=>setAttachment(value=>value?{...value,category}:value)};
}
