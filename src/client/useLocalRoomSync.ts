import {useEffect,useRef,useState} from "react";
import type {LocalState} from "../shared/local-chat";
import {localActivity,observeLocalState,LocalRequestError} from "./local-chat-api";

const interval=1500,timeout=10_000,maxBackoff=30_000;
export function useLocalRoomSync(enabled:boolean,options:{
  busy:()=>boolean;adopt:(state:LocalState)=>void;expired:()=>void;
}){
  const current=useRef(options);current.current=options;
  const [error,setError]=useState("");
  useEffect(()=>{
    if(!enabled)return;
    let stopped=false,failures=0,retryAt=0,lastAttempt=0;
    let timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
    const visible=()=>document.visibilityState==="visible";
    function schedule(delay=interval){
      clearTimeout(timer);
      if(!stopped&&visible())timer=setTimeout(()=>void poll(),delay);
    }
    async function poll(){
      if(stopped||!visible()||controller)return;
      if(Date.now()<retryAt){schedule(retryAt-Date.now());return;}
      if(current.current.busy()||localActivity().pending){schedule();return;}
      const ticket=localActivity().version,c=new AbortController();controller=c;lastAttempt=Date.now();
      let timedOut=false;
      const deadline=setTimeout(()=>{timedOut=true;c.abort();},timeout);
      try{
        const value=await observeLocalState(c.signal);
        if(stopped||c.signal.aborted||!visible())return;
        if(ticket!==localActivity().version||current.current.busy()||localActivity().pending)return;
        if(!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.messages))
          throw new LocalRequestError("not-configured");
        current.current.adopt(value);
        failures=0;retryAt=0;setError("");
      }catch(e){
        if(stopped||(!timedOut&&c.signal.aborted))return;
        // A concurrent local action may have closed/reopened the room.
        if(ticket!==localActivity().version)return;
        if(e instanceof LocalRequestError&&e.message==="auth-required"){
          stopped=true;setError("");current.current.expired();return;
        }
        setError(e instanceof LocalRequestError?e.message:"not-configured");
        retryAt=Date.now()+Math.min(maxBackoff,interval*2**Math.min(++failures,5));
      }finally{
        clearTimeout(deadline);if(controller===c)controller=undefined;
        schedule(Math.max(interval,retryAt-Date.now()));
      }
    }
    function resume(){
      if(!visible()){clearTimeout(timer);controller?.abort();return;}
      if(!stopped&&!controller)schedule(Math.max(0,retryAt-Date.now(),250-(Date.now()-lastAttempt)));
    }
    setError("");schedule();
    window.addEventListener("focus",resume);document.addEventListener("visibilitychange",resume);
    return ()=>{
      stopped=true;clearTimeout(timer);controller?.abort();
      window.removeEventListener("focus",resume);document.removeEventListener("visibilitychange",resume);
    };
  },[enabled]);
  return error;
}
