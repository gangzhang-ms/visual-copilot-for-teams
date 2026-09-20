import { closeSync, existsSync, fsyncSync, fstatSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { hostname, userInfo } from "node:os";
import { digest } from "./analysis-session";
import { GenerationError, requireGeneration, type GenerationBudget } from "./local-generation-config";
export type AllowanceKind="canary"|"ordinary";
export interface ImageAuthorization {authorizationId:string;approvedAt:number;expiresAt:number;owner:string}
type Event=
  | {type:"consume";kind:AllowanceKind;id:string;at:number}
  | {type:"finish";id:string;status:string;at:number;nextAt:number}
  | {type:"verify";reportHash:string;at:number};
export const imageOperatorOwner=()=>digest(`${process.platform}:${hostname()}:${userInfo().username}`);
export class ImageAllowance {
  readonly authorization:ImageAuthorization;
  constructor(readonly directory:string,authorization:ImageAuthorization){this.authorization=Object.freeze({...authorization});}
  private lock<T>(run:()=>T){
    const path=join(this.directory,"write.lock");let fd:number;
    try{fd=openSync(path,"wx",0o600);}catch{throw new GenerationError("generation-allowance-busy");}
    try{return run();}finally{closeSync(fd);unlinkSync(path);}
  }
  initialize(){
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    return this.lock(()=>{
      const anchor=join(this.directory,"grant.json"),journal=join(this.directory,"events.jsonl");
      if(existsSync(anchor)||existsSync(journal)){this.read();return;}
      const fd=openSync(anchor,"wx",0o600);
      try{writeSync(fd,JSON.stringify({version:1,...this.authorization,canary:1,ordinary:3})+"\n");fsyncSync(fd);}finally{closeSync(fd);}
      const events=openSync(journal,"wx",0o600);try{fsyncSync(events);}finally{closeSync(events);}
    });
  }
  private read(){
    try{
      requireGeneration(statSync(join(this.directory,"grant.json")).size<4096&&statSync(join(this.directory,"events.jsonl")).size<=65536,"generation-allowance-unavailable");
      const grant=JSON.parse(readFileSync(join(this.directory,"grant.json"),"utf8"));
      requireGeneration(grant.version===1&&grant.canary===1&&grant.ordinary===3
        && Object.keys(this.authorization).every(k=>grant[k]===this.authorization[k as keyof ImageAuthorization]),"generation-allowance-owner-mismatch");
      const raw=readFileSync(join(this.directory,"events.jsonl"),"utf8");
      requireGeneration(!raw||raw.endsWith("\n"),"generation-allowance-unavailable");
      const events:Event[]=raw?raw.trimEnd().split("\n").map(line=>JSON.parse(line)):[];
      const consumed=new Map<string,Extract<Event,{type:"consume"}>>(),finished=new Set<string>();let verified:string|undefined,nextAt=0;
      for(const event of events){
        requireGeneration(event&&Number.isSafeInteger(event.at)&&event.at>=this.authorization.approvedAt,"generation-allowance-unavailable");
        if(event.type==="consume"){
          requireGeneration(["canary","ordinary"].includes(event.kind)&&/^[A-Za-z0-9_-]{43}$/.test(event.id)&&!consumed.has(event.id)
            &&[...consumed.keys()].every(id=>finished.has(id)),"generation-allowance-unavailable");
          consumed.set(event.id,event);nextAt=Math.max(nextAt,event.at+61_000);
        }else if(event.type==="finish"){
          requireGeneration(consumed.has(event.id)&&!finished.has(event.id)&&Number.isSafeInteger(event.nextAt)&&event.nextAt>=event.at
            &&/^(ready|failed|cancelled|unknown-after-dispatch|generation-[a-z-]+)$/.test(event.status),"generation-allowance-unavailable");
          finished.add(event.id);nextAt=Math.max(nextAt,event.nextAt);
        }else if(event.type==="verify"){
          requireGeneration(!verified&&/^[A-Za-z0-9_-]{43}$/.test(event.reportHash)
            &&events.some(e=>e.type==="finish"&&e.status==="ready"&&consumed.get(e.id)?.kind==="canary"),"generation-allowance-unavailable");
          verified=event.reportHash;
        }else throw new GenerationError("generation-allowance-unavailable");
      }
      const counts={canary:0,ordinary:0};for(const e of consumed.values())counts[e.kind]++;
      requireGeneration(counts.canary<=1&&counts.ordinary<=3,"generation-allowance-unavailable");
      return {events,counts,verified,nextAt,active:[...consumed.keys()].find(id=>!finished.has(id))};
    }catch(error){if(error instanceof GenerationError)throw error;throw new GenerationError("generation-allowance-unavailable");}
  }
  private append(event:Event){
    const fd=openSync(join(this.directory,"events.jsonl"),"r+");
    try{
      const bytes=Buffer.from(JSON.stringify(event)+"\n"),at=fstatSync(fd).size;
      requireGeneration(at+bytes.length<=65536,"generation-allowance-unavailable");
      requireGeneration(writeSync(fd,bytes,0,bytes.length,at)===bytes.length,"generation-allowance-unavailable");fsyncSync(fd);
    }finally{closeSync(fd);}
  }
  status(kind:AllowanceKind){
    const value=this.read(),remaining=(kind==="canary"?1:3)-value.counts[kind];
    return {remaining,canaryHash:value.verified,nextAt:value.nextAt,
      reason:this.authorization.expiresAt<=Date.now()?"generation-approval-expired":remaining===0?"generation-budget-exhausted"
        :value.active?"generation-operation-unresolved":kind==="ordinary"&&!value.verified?"generation-canary-required"
        :Date.now()<value.nextAt?"generation-cooling-down":"available"};
  }
  consume(kind:AllowanceKind,operationId:string,now=Date.now()){
    this.lock(()=>{
      const state=this.status(kind);
      requireGeneration(now>=this.authorization.approvedAt&&now<this.authorization.expiresAt,"generation-approval-expired");
      requireGeneration(state.reason==="available",state.reason);
      const id=digest(operationId);requireGeneration(!this.read().events.some(e=>"id" in e&&e.id===id),"generation-operation-consumed");
      this.append({type:"consume",kind,id,at:now});
    });
  }
  finish(operationId:string,status:string,retryAfterMs=0){
    this.lock(()=>{
      const id=digest(operationId),state=this.read();
      requireGeneration(state.active===id&&/^(ready|failed|cancelled|unknown-after-dispatch|generation-[a-z-]+)$/.test(status),"generation-allowance-unavailable");
      const at=Date.now();this.append({type:"finish",id,status,at,nextAt:Math.max(at,state.nextAt,at+Math.min(300_000,Math.max(0,retryAfterMs)))});
    });
  }
  verifyCanary(reportHash:string){
    this.lock(()=>{
      const state=this.read();
      requireGeneration(!state.active&&state.counts.canary===1&&state.events.some(e=>e.type==="finish"&&e.status==="ready")
        &&(!state.verified||state.verified===reportHash)&&/^[A-Za-z0-9_-]{43}$/.test(reportHash),"generation-canary-required");
      if(!state.verified)this.append({type:"verify",reportHash,at:Date.now()});
    });
  }
  budget(kind:AllowanceKind):GenerationBudget {
    return {authorizationId:this.authorization.authorizationId,approvedAt:this.authorization.approvedAt,expiresAt:this.authorization.expiresAt,kind,
      status:()=>this.status(kind),consume:id=>this.consume(kind,id),finish:(id,status,retry)=>this.finish(id,status,retry)};
  }
}
