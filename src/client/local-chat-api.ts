import type {AnalysisResult,ReviewInput} from "../shared/types";
import type {LocalReview,LocalState} from "../shared/local-chat";
import {planningFailureReasons,validPlanningSchemaIssue,type PlanningFailureReason,type PlanningSchemaIssue} from "../shared/local-chat";
import {validDemoChatId} from "../shared/demo-room";
export function sharedDemoEnabled(){return typeof document!=="undefined"&&document.querySelector('meta[name="local-shared-demo"]')?.getAttribute("content")==="true";}
export function sharedDemoChatId(){
  const id=sharedDemoEnabled()?new URLSearchParams(window.location.search).get("chatId"):null;
  return validDemoChatId(id)?id:null;
}
let csrf = "";
let activeWork=0,activityVersion=0;
export function localActivity(){return {pending:activeWork,version:activityVersion};}
export function beginLocalWork(){
  activeWork++;activityVersion++;
  let finished=false;
  return ()=>{if(!finished){finished=true;activeWork--;activityVersion++;}};
}
export class LocalRequestError extends Error {
  readonly planningReason?:PlanningFailureReason;
  readonly planningIssues?:PlanningSchemaIssue[];
  readonly byteLimit?:{actualBytes:number;allowedBytes:number};
  constructor(code:string,limit?:{actualBytes?:unknown;allowedBytes?:unknown},planningReason?:unknown,planningIssues?:unknown){
    super(code);
    if(code==="generation-context-planning"&&planningFailureReasons.includes(planningReason as PlanningFailureReason))this.planningReason=planningReason as PlanningFailureReason;
    if((this.planningReason==="schema"||this.planningReason==="evidence")&&Array.isArray(planningIssues)&&planningIssues.length>0&&planningIssues.length<=20&&planningIssues.every(validPlanningSchemaIssue))
      this.planningIssues=planningIssues.map(({field,actualType,rule,actualLength,limit})=>({field,actualType,rule,
        ...(actualLength!==undefined?{actualLength,limit}:{})}));
    if(code==="model-request-envelope-exceeded"&&typeof limit?.actualBytes==="number"&&Number.isSafeInteger(limit.actualBytes)
      &&typeof limit.allowedBytes==="number"&&Number.isSafeInteger(limit.allowedBytes)&&limit.allowedBytes>0&&limit.actualBytes>limit.allowedBytes)
      this.byteLimit={actualBytes:limit.actualBytes,allowedBytes:limit.allowedBytes};
  }
}
export async function localRequest<T>(path: string, body: object = {}, signal?: AbortSignal): Promise<T> {
  const finish=beginLocalWork();
  try{return await request<T>(path,body,signal);}finally{finish();}
}
// Observation bypasses the activity fence; every interactive request crosses it.
export function observeLocalState(signal:AbortSignal){return request<LocalState>("state",{},signal);}
// Reassert this window's speaker only as part of an explicit AI preparation.
export function ensureLocalSpeaker(state:LocalState,speaker:string,signal?:AbortSignal):Promise<LocalState>{
  if(!speaker.trim())return Promise.reject(new LocalRequestError("processing-review-required"));
  return state.outgoingSpeaker===speaker.trim()?Promise.resolve(state):localRequest<LocalState>("speaker",{speaker:speaker.trim()},signal);
}
async function request<T>(path:string,body:object,signal?:AbortSignal):Promise<T>{
  const chatId=sharedDemoChatId();
  if(sharedDemoEnabled()&&!chatId)throw new LocalRequestError("processing-review-required");
  const response = await fetch(`/local/${path}${chatId?`?chatId=${encodeURIComponent(chatId)}`:""}`, { method: "POST", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-Local-CSRF": csrf } : {}) }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new LocalRequestError(typeof value.code === "string" ? value.code : "not-configured",value.byteLimit,value.planningReason,value.planningIssues);
  if (path === "session") csrf = value.csrf;
  if (path === "session/close") csrf = "";
  return value;
}

export async function explainLocalMessage(request:typeof localRequest,selectedId:string,input:ReviewInput,signal:AbortSignal){
  const current=await request<LocalState>("cancel",{},signal);
  const review=await request<LocalReview>("review",{revision:current.revision,selectedId,command:"explainVisual",input},signal);
  return request<{result:AnalysisResult;state:LocalState}>("process",
    {revision:review.revision,digest:review.processing.digest,consent:true},signal);
}
