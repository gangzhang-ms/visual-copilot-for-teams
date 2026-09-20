import template from "../../config/visual-generation.development.json";
import type { GenerationDestination, LocalGenerationReadiness } from "../shared/local-chat";
import { digest, opaque } from "./analysis-session";
export class GenerationError extends Error { constructor(readonly code: string) { super(code); } }
export function requireGeneration(value: unknown, code: string): asserts value { if (!value) throw new GenerationError(code); }
export const generationLimits = Object.freeze({
  prompt: 16 * 1024, request: 20 * 1024, response: 12 * 1024 * 1024, encoded: 11_184_812, decoded: 8 * 1024 * 1024,
  pixels: 1_048_576, raw: 4_194_304, png: 1024 * 1024, gif: 1024 * 1024, frames: 12, framePixels: 3_145_728, stacked: 12_582_912,
  session: 8 * 1024 * 1024, artifact: 2 * 1024 * 1024, explain: 256 * 1024, workerMs: 15_000, httpMs: 120_000, totalMs: 135_000
});
export type RoomMediaPolicy={kind:"account-only"}|{kind:"bounded";bytes:number};
export const roomMediaPolicy=(direct:boolean):RoomMediaPolicy=>direct?{kind:"account-only"}:{kind:"bounded",bytes:generationLimits.session};
export function withinRoomMediaBudget(bytes:number,policy:RoomMediaPolicy=roomMediaPolicy(false)){
  return policy.kind==="account-only"||bytes<=policy.bytes;
}
export interface ImageProfile extends GenerationDestination {
  endpoint: string; version: string; expiresAt: number|null; minIntervalMs: number; validity?:"ongoing-personal";
  evidence: { deployment: string; access: string; api: string; quota: string; resources: string; terms: string };
}
export function loadGenerationProfile(value: unknown = template.profile): ImageProfile | undefined {
  if (!value || typeof value !== "object") return;
  const p = value as ImageProfile;
  const ongoing=p.validity==="ongoing-personal"&&p.expiresAt===null&&p.deployment==="your-image-deployment";
  if(p.validity!==undefined&&!ongoing)return;
  if (p.account !== "your-azure-openai-resource" || p.endpoint !== "https://your-azure-openai-resource.openai.azure.com/"
    || p.model !== "gpt-image-1.5" || p.modelVersion !== "2025-12-16" || p.region !== "US" || p.sku !== "DataZoneStandard"
    || p.apiVersion !== "2025-04-01-preview" || !/^[a-z0-9-]{1,64}$/.test(p.deployment ?? "")
    || (!ongoing&&(!Number.isSafeInteger(p.expiresAt)||p.expiresAt===null||p.expiresAt<=Date.now())) || !Number.isSafeInteger(p.minIntervalMs) || p.minIntervalMs < 61_000
    || !p.version || !p.evidence || !["deployment", "access", "api", "quota", "resources", "terms"].every(k => typeof p.evidence[k as keyof ImageProfile["evidence"]] === "string" && p.evidence[k as keyof ImageProfile["evidence"]].length > 0)) return;
  return structuredClone(p);
}
export function destination(p: ImageProfile): GenerationDestination {
  return { account: p.account, deployment: p.deployment, model: p.model, modelVersion: p.modelVersion, region: p.region, sku: p.sku, apiVersion: p.apiVersion };
}
export interface RunApproval {
  mode: "validation-only" | "ready"; invocationNonce: string; expiresAt: number; approvedCalls: number; budgetVersion: string;
  deploymentApproval: string; costApproval: string; contentApproval: string; syntheticBodyDigest?: string;
  acceptedRisks: string[]; acceptedCanary?: string;
  personalAuthorization?: {id:string;approvedAt:number;scope:"personal-local-images";technicalCanary?:string};
}
export interface GenerationBudget {
  authorizationId:string;approvedAt:number;expiresAt:number;kind:"canary"|"ordinary";
  status:()=>{remaining:number;reason:string;nextAt:number;canaryHash?:string};
  consume:(operationId:string)=>void;finish:(operationId:string,status:string,retryAfterMs?:number)=>void;
}
const issued = new WeakMap<object, { profileDigest: string; approval: RunApproval; remaining: number;budget?:GenerationBudget }>();
const invocations=new Map<string,{token:object;profileDigest:string;approvalDigest:string}>();
const ongoingAdmissions=new WeakMap<object,{profileDigest:string;binding:string}>();
export function issueOngoingPersonalAdmission(profile:ImageProfile){
  requireGeneration(loadGenerationProfile(profile)&&profile.validity==="ongoing-personal"&&profile.expiresAt===null,"generation-capability-unavailable");
  const token=Object.freeze({nonce:opaque()});
  ongoingAdmissions.set(token,{profileDigest:digest(JSON.stringify(profile)),binding:opaque()});return token;
}
// The personal launcher must supply a durable operator-owned budget, never a browser flag.
export function issueGenerationAdmission(profile: ImageProfile, approval: RunApproval,budget?:GenerationBudget): object {
  requireGeneration(loadGenerationProfile(profile) && approval.invocationNonce.length >= 20 && approval.expiresAt > Date.now()
    && profile.expiresAt!==null && approval.expiresAt <= profile.expiresAt && approval.budgetVersion && approval.deploymentApproval && approval.costApproval && approval.contentApproval
    && Number.isSafeInteger(approval.approvedCalls) && approval.approvedCalls >= 1 && approval.approvedCalls <= 10, "generation-approval-required");
  const personal=approval.personalAuthorization;
  if(personal){
    requireGeneration(personal.scope==="personal-local-images"&&budget&&budget.authorizationId===personal.id&&budget.approvedAt===personal.approvedAt
      &&Number.isSafeInteger(personal.approvedAt)&&personal.approvedAt<=Date.now()&&budget.expiresAt===approval.expiresAt
      &&approval.expiresAt<=personal.approvedAt+86_400_000,"generation-approval-required");
    requireGeneration(approval.mode==="validation-only"?budget.kind==="canary"&&approval.approvedCalls===1
      :budget.kind==="ordinary"&&approval.approvedCalls<=3&&personal.technicalCanary&&budget.status().canaryHash===personal.technicalCanary,"generation-canary-required");
  }else requireGeneration(["R01","R02","R03","R04","R05","R06"].every(r => approval.acceptedRisks.includes(r)), "generation-approval-required");
  requireGeneration(approval.mode === "validation-only"
    ? approval.approvedCalls === 1 && /^[A-Za-z0-9_-]{43}$/.test(approval.syntheticBodyDigest ?? "")
    : approval.mode === "ready" && (personal?.technicalCanary || approval.acceptedCanary && ["R01","R02","R03","R04","R05","R06"].every(r => approval.acceptedRisks.includes(r))), "generation-approval-required");
  const profileDigest=digest(JSON.stringify(profile)),approvalDigest=digest(JSON.stringify(approval)),invocation=digest(approval.invocationNonce);
  const existing=invocations.get(invocation);
  if(existing){requireGeneration(existing.profileDigest===profileDigest&&existing.approvalDigest===approvalDigest,"generation-run-reuse-denied");return existing.token;}
  requireGeneration(invocations.size<64,"generation-operation-limit");
  const token = Object.freeze({ nonce: opaque() });
  issued.set(token, { profileDigest, approval: structuredClone(approval), remaining: approval.approvedCalls,budget });
  invocations.set(invocation,{token,profileDigest,approvalDigest});
  return token;
}
export function generationReadiness(profile?: ImageProfile, token?: object): LocalGenerationReadiness {
  const ongoing=token&&ongoingAdmissions.get(token);
  if(ongoing&&profile&&loadGenerationProfile(profile)&&ongoing.profileDigest===digest(JSON.stringify(profile))){
    const cooling=Date.now()<localPaidLease.providerNextAt,busy=localPaidLease.busy||generatedWorkerLease.busy;
    return {mode:"ready",ready:!busy&&!cooling,reason:busy?"generation-busy":cooling?"generation-cooling-down":"available",
      remainingCalls:null,scope:"ongoing-personal",cooldownUntil:localPaidLease.providerNextAt,destination:destination(profile)};
  }
  const grant = token && issued.get(token);
  const valid = profile && loadGenerationProfile(profile) && grant && grant.profileDigest === digest(JSON.stringify(profile)) && grant.approval.expiresAt > Date.now();
  let durable:ReturnType<GenerationBudget["status"]>|undefined;
  try{durable=grant?.budget?.status();}catch{return {mode:"disabled",ready:false,remainingCalls:0,reason:"generation-allowance-unavailable"};}
  const remaining=valid?Math.min(grant.remaining,durable?.remaining??grant.remaining):0;
  const budgetReason=durable&&durable.reason!=="available"?durable.reason:undefined;
  return { mode: valid ? grant.approval.mode : "disabled", ready: !!valid && grant.approval.mode === "ready" && remaining>0&&!budgetReason,
    reason: !profile ? "image-not-provisioned-or-authorized" : !valid ? durable?.reason==="generation-approval-expired"?durable.reason:"generation-approval-required" : budgetReason??(remaining === 0 ? "generation-budget-exhausted" : grant.approval.mode === "validation-only" ? "validation-only-not-browser-ready" : "available"),
    remainingCalls:remaining, ...(profile ? { destination: destination(profile) } : {}),
    ...(durable?{durable:true,cooldownUntil:durable.nextAt,expiresAt:grant?.approval.expiresAt,scope:"personal-local-images" as const}: {}) };
}
export function admissionBudget(token?: object) { return token&&ongoingAdmissions.has(token)?"ongoing-personal-no-count-limit":token && issued.get(token)?.approval.budgetVersion || "unapproved"; }
export function admissionBinding(token?: object) { return token&&ongoingAdmissions.get(token)?.binding||token && issued.get(token)?.approval.invocationNonce || "unapproved"; }
export function admissionExpiry(token?: object) { return token && issued.get(token)?.approval.expiresAt || Infinity; }
export function consumeAdmission(profile: ImageProfile, token: object | undefined, bodyDigest: string, operator: boolean,operationId=opaque()) {
  const state = generationReadiness(profile, token), grant = token && issued.get(token);
  // The owning service consumes/replays each operation; this scope has no count budget.
  if(token&&ongoingAdmissions.has(token)){requireGeneration(state.scope==="ongoing-personal","generation-approval-required");return;}
  requireGeneration(grant && state.mode !== "disabled" && state.remainingCalls!==null && state.remainingCalls > 0, state.reason);
  requireGeneration(state.mode === "ready" || operator && grant.approval.syntheticBodyDigest === bodyDigest, "validation-only-not-browser-ready");
  grant.budget?.consume(operationId);
  grant.remaining--;
}
export function finishAdmission(token:object|undefined,operationId:string,status:string,retryAfterMs?:number){if(token)issued.get(token)?.budget?.finish(operationId,status,retryAfterMs);}
export type LeasePacing={kind:"provider-backoff-only"}|{kind:"fixed-interval";intervalMs:number};
export function generationPacing(profile:ImageProfile,token?:object):LeasePacing{
  const ongoing=token&&ongoingAdmissions.get(token);
  return ongoing?.profileDigest===digest(JSON.stringify(profile))
    ?{kind:"provider-backoff-only"}:{kind:"fixed-interval",intervalMs:profile.minIntervalMs};
}
export class LocalLease {
  busy = false; nextAt = 0; providerNextAt = 0; private poisoned = false;
  acquire(pacing: number|LeasePacing = 0, now = Date.now()) {
    const policy=typeof pacing==="number"?{kind:"fixed-interval" as const,intervalMs:pacing}:pacing;
    const next=policy.kind==="provider-backoff-only"?this.providerNextAt:this.nextAt;
    requireGeneration(!this.poisoned && !this.busy && now >= next, "generation-busy");
    this.busy = true; let released = false;
    return { dispatched: () => { if(policy.kind==="fixed-interval")this.pace(policy.intervalMs); },
      release: () => { if (!released) { released = true; this.busy = this.poisoned; } } };
  }
  pace(ms:number){this.nextAt=Math.max(this.nextAt,Date.now()+ms);}
  defer(ms: number) {
    this.providerNextAt=Math.max(this.providerNextAt,Date.now()+Math.min(300_000,Math.max(0,ms)));
    this.nextAt=Math.max(this.nextAt,this.providerNextAt);
  }
  poison() { this.poisoned = true; this.busy = true; }
}
export const localPaidLease = new LocalLease();
export const generatedWorkerLease = new LocalLease();
