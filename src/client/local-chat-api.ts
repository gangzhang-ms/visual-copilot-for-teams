import type {AnalysisResult,ReviewInput} from "../shared/types";
import type {LocalReview,LocalState} from "../shared/local-chat";
let csrf = "";
export class LocalRequestError extends Error {
  readonly byteLimit?:{actualBytes:number;allowedBytes:number};
  constructor(code:string,limit?:{actualBytes?:unknown;allowedBytes?:unknown}){
    super(code);
    if(code==="model-request-envelope-exceeded"&&typeof limit?.actualBytes==="number"&&Number.isSafeInteger(limit.actualBytes)
      &&typeof limit.allowedBytes==="number"&&Number.isSafeInteger(limit.allowedBytes)&&limit.allowedBytes>0&&limit.actualBytes>limit.allowedBytes)
      this.byteLimit={actualBytes:limit.actualBytes,allowedBytes:limit.allowedBytes};
  }
}
export async function localRequest<T>(path: string, body: object = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/local/${path}`, { method: "POST", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-Local-CSRF": csrf } : {}) }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new LocalRequestError(typeof value.code === "string" ? value.code : "not-configured",value.byteLimit);
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
