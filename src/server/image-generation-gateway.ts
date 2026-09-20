import type { Transport } from "./graph-context";
import { generationLimits as limits, loadGenerationProfile, requireGeneration, GenerationError, localPaidLease, type ImageProfile } from "./local-generation-config";
export async function imageResponseBytes(response: Response, signal: AbortSignal, maximum: number = limits.response): Promise<Buffer> {
  const reader = response.body?.getReader(); requireGeneration(reader, "generation-invalid-response");
  const chunks: Buffer[] = []; let size = 0;
  let cancellation:Promise<void>|undefined;
  const cancel=()=>cancellation??=reader.cancel();
  const abort = () => { void cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      requireGeneration(!signal.aborted, "generation-cancelled");
      const part = await reader.read(); requireGeneration(!signal.aborted, "generation-cancelled");
      if (part.done) break;
      size += part.value.byteLength; requireGeneration(size <= maximum, "generation-response-too-large");
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks);
  } finally { signal.removeEventListener("abort", abort); await cancel().catch(() => {}); reader.releaseLock(); }
}
export function decodeImageResponse(raw: Buffer) {
  requireGeneration(raw.length <= limits.response, "generation-response-too-large");
  let value: unknown; try { value = JSON.parse(raw.toString("utf8")); } catch { throw new GenerationError("generation-invalid-response"); }
  requireGeneration(value && typeof value === "object" && "data" in value && Array.isArray(value.data) && value.data.length === 1, "generation-invalid-response");
  const image = value.data[0];
  requireGeneration(image && typeof image === "object" && !("url" in image) && typeof image.b64_json === "string"
    && image.b64_json.length > 0 && image.b64_json.length <= limits.encoded && /^[A-Za-z0-9+/]+={0,2}$/.test(image.b64_json), "generation-invalid-response");
  const bytes = Buffer.from(image.b64_json, "base64");
  requireGeneration(bytes.length <= limits.decoded && bytes.toString("base64") === image.b64_json
    && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "generation-invalid-response");
  return bytes;
}
export interface ImageCapabilityState { reason?: "generation-access-denied" | "generation-capability-unavailable" | "generation-billing-unavailable" }
async function providerErrorCodes(response:Response,signal:AbortSignal):Promise<string[]> {
  if(!response.body)return [];
  if(!response.headers.get("content-type")?.toLowerCase().includes("application/json")){await response.body?.cancel();return [];}
  let raw:Buffer;
  try{raw=await imageResponseBytes(response,signal,32*1024);}
  catch(error){if(error instanceof GenerationError&&error.code==="generation-response-too-large")return [];throw error;}
  let value:unknown;try{value=JSON.parse(raw.toString("utf8"));}catch(error){if(error instanceof SyntaxError)return [];throw error;}
  const codes:string[]=[];
  const record=(node:unknown):node is Record<string,unknown>=>!!node&&typeof node==="object"&&!Array.isArray(node);
  const visit=(node:unknown,depth:number)=>{
    if(!record(node)||depth>3)return;
    if(typeof node.code==="string"&&node.code.length<=80)codes.push(node.code.toLowerCase());
    for(const key of ["error","innererror","inner_error"] as const)visit(node[key],depth+1);
  };
  visit(value,0);return codes;
}
export function classifyImageFailure(status:number,codes:readonly string[]) {
  if(status===429)return "generation-rate-limited";
  if(status>=500)return "generation-provider-unavailable";
  if(status===401)return "generation-access-denied";
  if(codes.some(code=>["content_policy_violation","responsibleaipolicyviolation","content_filter","contentfilter","safety_violation"].includes(code)))return "generation-refused";
  if(status===403)return "generation-access-denied";
  if(status===402)return "generation-billing-unavailable";
  if(codes.some(code=>["deploymentnotfound","operationnotsupported","invalidapiversionparameter","unsupported_api_version","unsupported_model","model_not_found","unsupported_parameter"].includes(code)))return "generation-capability-unavailable";
  if(status===404)return "generation-capability-unavailable";
  if(status===413)return "generation-request-too-large";
  return "generation-request-rejected";
}
export class ImageGenerationGateway {
  private localSuspension?:string;
  get suspended(){return !!this.blockedReason;}
  get blockedReason(){return this.capability.reason??this.localSuspension;}
  suspend(reason:string){this.localSuspension=reason;}
  metrics: {httpStatus?:number;failureCode?:string;elapsedMs:number;responseBytes?:number;sourceBytes?:number;sourceWidth?:number;sourceHeight?:number;retryAfterMs?:number}={elapsedMs:0};
  constructor(private readonly key: string, private readonly transport: Transport = fetch,private readonly capability:ImageCapabilityState={}) {}
  async run(profile: ImageProfile, body: string, signal: AbortSignal) {
    requireGeneration(this.key && loadGenerationProfile(profile) && !this.suspended, "generation-capability-unavailable");
    requireGeneration(Buffer.byteLength(body) <= limits.request, "generation-request-too-large");
    const request = JSON.parse(body);
    requireGeneration(Object.keys(request).sort().join(",") === "n,output_format,prompt,quality,size" && request.n === 1
      && request.size === "1024x1024" && request.quality === "low" && request.output_format === "png"
      && typeof request.prompt === "string" && Buffer.byteLength(request.prompt) <= limits.prompt, "generation-invalid-request");
    const combined = AbortSignal.any([signal, AbortSignal.timeout(limits.httpMs)]);
    const started=performance.now();this.metrics={elapsedMs:0};
    try {
      requireGeneration(!combined.aborted, "generation-cancelled");
      const response = await this.transport(`${profile.endpoint}openai/deployments/${encodeURIComponent(profile.deployment)}/images/generations?api-version=${profile.apiVersion}`,
        { method: "POST", redirect: "error", signal: combined, headers: { "Content-Type": "application/json", "api-key": this.key }, body });
      this.metrics.httpStatus=response.status;
      if (!response.ok || response.redirected) {
        if (response.status === 429) {
          const retry = response.headers.get("retry-after") ?? "";
          const seconds = Number(retry);const wait=retry&&Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry)-Date.now())||61_000;
          this.metrics.retryAfterMs=Math.min(300_000,Math.max(0,wait));localPaidLease.defer(this.metrics.retryAfterMs);
        }
        let codes:string[]=[];
        if([400,403,404,422].includes(response.status))codes=await providerErrorCodes(response,combined);
        else await response.body?.cancel();
        const code=response.redirected?"generation-capability-unavailable":classifyImageFailure(response.status,codes);
        this.metrics.failureCode=code;
        if(code==="generation-access-denied"||code==="generation-capability-unavailable"||code==="generation-billing-unavailable")this.capability.reason=code;
        throw new GenerationError(code);
      }
      if(!response.headers.get("content-type")?.includes("application/json")){await response.body?.cancel();throw new GenerationError("generation-invalid-response");}
      const raw=await imageResponseBytes(response,combined),bytes=decodeImageResponse(raw);
      this.metrics.responseBytes=raw.length;this.metrics.sourceBytes=bytes.length;
      if(bytes.length>=24){this.metrics.sourceWidth=bytes.readUInt32BE(16);this.metrics.sourceHeight=bytes.readUInt32BE(20);}
      return bytes;
    } catch (error) {
      if (combined.aborted) throw new GenerationError(signal.aborted ? "generation-cancelled" : "generation-timeout");
      if (error instanceof GenerationError) {
        if(["generation-invalid-response","generation-response-too-large"].includes(error.code))this.suspend(error.code);
        throw error;
      }
      throw new GenerationError("generation-unknown-after-dispatch");
    }finally{this.metrics.elapsedMs=Math.round(performance.now()-started);}
  }
}
