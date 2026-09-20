import { closeSync, fsyncSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { resolve, join } from "node:path";
import type { LocalGenerationDraft } from "../shared/local-chat";
import { digest } from "./analysis-session";
import { buildCreativeBrief } from "./local-generation";
import { ImageAllowance, imageOperatorOwner, type AllowanceKind } from "./image-allowance";
export { ImageAllowance } from "./image-allowance";
import { issueGenerationAdmission, issueOngoingPersonalAdmission, requireGeneration, type ImageProfile, type RunApproval } from "./local-generation-config";

export function ongoingPersonalGenerationOptions(){
  const profile:ImageProfile={
    account:"your-azure-openai-resource",endpoint:"https://your-azure-openai-resource.openai.azure.com/",
    deployment:"your-image-deployment",model:"gpt-image-1.5",modelVersion:"2025-12-16",region:"US",sku:"DataZoneStandard",
    apiVersion:"2025-04-01-preview",version:"personal-ongoing-20260914",validity:"ongoing-personal",expiresAt:null,minIntervalMs:61_000,
    evidence:{
      deployment:"Management read 2026-09-14: your-image-deployment Succeeded, US DataZoneStandard capacity 1.",
      access:"Actual 2026-09-14 09:13:12 UTC canary HTTP 200; historical image-allowance/canary-report.json. No new certification.",
      api:"2025-04-01-preview: one actual 1024 PNG -> 512 PNG -> 128 Explain normalization verified.",
      quota:"Historical Azure service-side rate 1 image request / 60 seconds; no quota change. Personal admission removes local fixed pacing; actual provider Retry-After and physical one-operation leases remain.",
      resources:"Existing bounded workers, leases and media limits retained. One observed 107999232-byte RSS peak is not a hard native-memory guarantee.",
      terms:"User expressly requested ongoing billable personal use without permission checkboxes, material attestation, count budget or daily expiry on 2026-09-14. Each explicit AI button click requests billing; not company-data or production approval."
    }
  };
  return {profile,admission:issueOngoingPersonalAdmission(profile)};
}

export const personalImageAuthorization=Object.freeze({
  authorizationId:"personal-image-20260914-165943",
  approvedAt:Date.parse("2026-09-14T16:59:43+08:00"),
  expiresAt:Date.parse("2026-09-15T16:59:43+08:00")
});
export function personalAllowance(){
  return new ImageAllowance(resolve(".local","visual-context","image-allowance"),{...personalImageAuthorization,owner:imageOperatorOwner()});
}
export const personalCanaryDraft:LocalGenerationDraft={
  intent:"Create an original abstract welcome illustration for a fictional puzzle club.",
  creative:"An original flat geometric composition on a cream background: one teal circle, one coral square and three small golden triangles arranged as a friendly balanced group. Soft clean edges, no lettering, people, brands, symbols or recognizable existing art.",
  output:"image",context:[],preferences:{source:"requester-reported",language:"en",culture:"",familiarity:"",tone:"friendly",relationship:"",humor:"",avoid:"letters, logos, recognizable existing art"}
};
export function recordPersonalCanary(report:{allPassed:boolean;providerRequests:number;httpStatus?:number;apiVersion:string;[key:string]:unknown}){
  const ledger=personalAllowance(),raw=JSON.stringify(report,null,2)+"\n";
  requireGeneration(Buffer.byteLength(raw)<=32768,"generation-canary-report-invalid");
  const fd=openSync(join(ledger.directory,"canary-report.json"),"wx",0o600);
  try{requireGeneration(writeSync(fd,raw)===Buffer.byteLength(raw),"generation-canary-report-invalid");fsyncSync(fd);}finally{closeSync(fd);}
  if(report.allPassed){
    requireGeneration(report.providerRequests===1&&report.httpStatus===200&&report.apiVersion==="2025-04-01-preview","generation-canary-report-invalid");
    ledger.verifyCanary(digest(raw));
  }
}
export function personalGenerationOptions(kind:AllowanceKind){
  const ledger=personalAllowance(),status=ledger.status(kind);
  let canary:string|undefined;
  if(kind==="ordinary"){
    const path=join(ledger.directory,"canary-report.json");
    requireGeneration(statSync(path).size<=32768,"generation-canary-report-invalid");
    const raw=readFileSync(path,"utf8"),report=JSON.parse(raw);
    requireGeneration(report.allPassed===true&&report.providerRequests===1&&report.httpStatus===200
      &&report.apiVersion==="2025-04-01-preview"&&report.authorizationId===personalImageAuthorization.authorizationId
      &&status.canaryHash===digest(raw),"generation-canary-required");canary=digest(raw);
  }
  const profile:ImageProfile={
    account:"your-azure-openai-resource",endpoint:"https://your-azure-openai-resource.openai.azure.com/",
    deployment:"your-image-deployment",model:"gpt-image-1.5",modelVersion:"2025-12-16",region:"US",sku:"DataZoneStandard",
    apiVersion:"2025-04-01-preview",version:canary?`personal-1024-low-png-${canary.slice(0,12)}`:"personal-first-canary-pending-data-plane",
    expiresAt:personalImageAuthorization.expiresAt,minIntervalMs:61_000,
    evidence:{
      deployment:"2026-09-14 Azure management read: your-image-deployment Succeeded; gpt-image-1.5/2025-12-16; US DataZoneStandard capacity 1.",
      access:canary?`One successful personal data-plane canary: ${canary}`:"PENDING: only the expressly authorized one-call operator canary may establish access.",
      api:canary?`2025-04-01-preview singleton base64 PNG validated by canary ${canary}`:"Microsoft documented 2025-04-01-preview; actual contract validation still pending.",
      quota:"Management rate record: 1 request / 60 seconds. Durable ledger enforces >=61 seconds and 1 canary + 3 ordinary attempts.",
      resources:canary?`Measured one source 1024 PNG through canonical 512 and Explain 128 worker path; report ${canary}. Not a hard native RSS guarantee.`:"Offline 1024/512/128 bounded native path tested; live input not yet measured.",
      terms:"Personal local development approved 2026-09-14 16:59:43 +08. Per-request content/cost consent; no company data, production, corporate rights, cultural accuracy or provider-retention certification."
    }
  };
  const approval:RunApproval={
    mode:kind==="canary"?"validation-only":"ready",invocationNonce:`${personalImageAuthorization.authorizationId}-${kind}`,
    expiresAt:personalImageAuthorization.expiresAt,approvedCalls:kind==="canary"?1:3,budgetVersion:"durable-personal-one-plus-three-v1",
    deploymentApproval:"Explicit personal image deployment/use authorization at 2026-09-14 16:59:43 +08",
    costApproval:"One initial paid canary, then at most three individually confirmed personal requests; dispatched failures/cancellation consume allowance.",
    contentApproval:"Original non-sensitive synthetic canary; ordinary requests require explicit owned-test-content consent. No company data.",
    acceptedRisks:[],personalAuthorization:{id:personalImageAuthorization.authorizationId,approvedAt:personalImageAuthorization.approvedAt,scope:"personal-local-images",...(canary?{technicalCanary:canary}:{})},
    ...(kind==="canary"?{syntheticBodyDigest:digest(buildCreativeBrief(personalCanaryDraft,[]).body)}:{})
  };
  return {profile,admission:issueGenerationAdmission(profile,approval,ledger.budget(kind))};
}
