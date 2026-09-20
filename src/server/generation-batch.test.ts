import {beforeEach,expect,it,vi} from "vitest";
import {LocalGenerationSession,buildCreativeBrief,type GenerationSourceResolution} from "./local-generation";
import {loadLocalCatalog} from "./local-catalog";
import {VisualError} from "./visual-errors";
import {searchWebImages} from "./web-image-search";
import {ongoingPersonalGenerationOptions} from "./personal-image";
import {generatedWorkerLease,localPaidLease} from "./local-generation-config";
import {generatedMedia} from "./generated-media-host";
import {offlineDraft} from "./generation.test.support";
import type {GenerationInspiration,LocalMessage} from "../shared/local-chat";
vi.mock("./generated-media-host",async original=>({
  ...await original<typeof import("./generated-media-host")>(),generatedMedia:vi.fn()
}));
const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100)]);
const imageResponse=()=>new Response(JSON.stringify({data:[{b64_json:image.toString("base64")}]}),{headers:{"Content-Type":"application/json"}});
const inspiration:GenerationInspiration={mode:"popular-text",provider:"Imgflip",fetchedAt:123,selection:"local-keyword-match",
  references:[{name:"Two Buttons",pattern:"Indecision between two choices; a playful dilemma.",sourceUrl:"https://imgflip.com/meme/87743020"}]};
beforeEach(()=>{
  expect(localPaidLease.busy).toBe(false);expect(generatedWorkerLease.busy).toBe(false);
  localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  vi.mocked(generatedMedia).mockReset().mockImplementation(async operation=>({
    ...(operation==="animate"?{animation:Buffer.from("MOCK-GIF")}:{image}),
    diagnostics:{elapsedMs:1,cpuMicros:{user:0,system:0},rssStart:0,rssEnd:0,isolatedEnvironment:true}
  }));
});
function fixture(respond?:(call:number)=>Promise<Response>,mixedSource?:()=>Promise<GenerationSourceResolution>){
  let revision=1;const messages:LocalMessage[]=[],bodies:string[]=[];
  const source=vi.fn(async()=>structuredClone(inspiration));
  const session=new LocalGenerationSession({id:"OFFLINE-BATCH-OWNER",expiresAt:Date.now()+600_000,revision:()=>revision,messages:()=>messages,ordinaryBytes:()=>0,mediaPolicy:{kind:"account-only"}},
    "OFFLINE-BATCH-KEY",{...ongoingPersonalGenerationOptions(),creationChoices:true,mixedCreation:!!mixedSource,source:mixedSource,inspiration:source,transport:async(_url,init)=>{
      bodies.push(String(init?.body));return respond?respond(bodies.length):imageResponse();
    }});
  return {session,source,bodies,messages,revise:()=>{revision++;session.invalidate();}};
}
async function mixedFixture(respond?:(call:number)=>Promise<Response>){
  const visual=(await loadLocalCatalog(true)).assets[0].public,release=vi.fn();
  const source=vi.fn(async():Promise<GenerationSourceResolution>=>({source:{visual,release},inspiration}));
  return {...fixture(respond,source),mixedSource:source,sourceRelease:release,visual};
}
it("mixed creation keeps an existing asset separate and dispatches exactly two photographic prompts",async()=>{
  const {session,mixedSource,sourceRelease,bodies,visual}=await mixedFixture();
  const draft={...offlineDraft(),intent:"Two fictional detectives, Sherlock Holmes and Watson, thanking their team."};
  const review=await session.reviewBatch(draft,0,3,"popular-text");
  expect(review.existing).toMatchObject({kind:"existing",status:"ready",visual,caption:draft.intent,captionOrigin:"verbatim-intent"});
  expect(review.requests).toHaveLength(2);expect(bodies).toHaveLength(0);
  expect(review.candidates.map(c=>c.treatment)).toEqual(["natural-photo","cinematic-photo"]);
  const inputs=review.requests.map(r=>JSON.parse(JSON.parse(r.body).prompt.split("\n").at(-1)!));
  expect(inputs[0].styleDirection).toContain("photographic");expect(inputs[1].styleDirection).toContain("photographic");
  expect(inputs[0].styleDirection).not.toBe(inputs[1].styleDirection);
  expect(inputs.every(d=>d.intent===draft.intent)).toBe(true);
  await session.startBatch(review.batchId,review.digest,0,true).work;
  expect(bodies).toHaveLength(2);expect(mixedSource).toHaveBeenCalledTimes(1);
  const preview=session.previewExisting(review.batchId,review.digest,"Thanks, team!","Alex");
  expect(session.insertExisting(preview.handle)).toMatchObject({visual,caption:"Thanks, team!"});
  session.invalidate(true);expect(sourceRelease).toHaveBeenCalledTimes(1);
});
it("mixed source failure does not need a second authorization; source-only retry preserves both successful AI outputs",async()=>{
  const {session,mixedSource,bodies}=await mixedFixture();
  mixedSource.mockResolvedValueOnce({code:"generation-source-no-match"});
  const review=await session.reviewBatch(offlineDraft(),0,3,"popular-text");
  expect(review.inspiration).toBeUndefined();
  expect(bodies).toHaveLength(0);
  await session.startBatch(review.batchId,review.digest,0,true).work;
  expect(session.batchStatus(review.batchId).status).toBe("ready");
  const saved=session.batchStatus(review.batchId).candidates.map(c=>c.operation.image!.assetId);
  const renewed=await session.retryExisting(review.batchId,review.digest);
  expect(renewed.existing?.status).toBe("ready");expect(renewed.digest).not.toBe(review.digest);
  expect(renewed.candidates.map(c=>c.operation.image!.assetId)).toEqual(saved);
  expect(bodies).toHaveLength(2);expect(mixedSource).toHaveBeenCalledTimes(2);
  expect(renewed.inspiration).toBeUndefined();
  expect(()=>session.previewExisting(review.batchId,review.digest,"caption","Alex")).toThrow();
  session.invalidate(true);
});
it("an unconfigured web search remains explicit while the same click completes exactly two AI images",async()=>{
  const source=vi.fn(async():Promise<GenerationSourceResolution>=>{
    const result=await searchWebImages(undefined,undefined,new AbortController().signal);
    if(result.status!=="unavailable")throw new Error("Expected an unconfigured provider");
    return {code:result.code};
  });
  const {session,bodies}=fixture(undefined,source);
  const review=await session.reviewBatch(offlineDraft(),0,3,"popular-text");
  expect(review.existing).toMatchObject({status:"failed",code:"web-image-search-not-configured"});
  await session.startBatch(review.batchId,review.digest,0,true).work;
  const before=session.batchStatus(review.batchId);
  expect(before.status).toBe("ready");expect(before.candidates.every(c=>c.operation.status==="ready")).toBe(true);
  expect(bodies).toHaveLength(2);expect(bodies.every(body=>!body.includes("publicTextInspiration"))).toBe(true);
  const after=await session.retryExisting(review.batchId,review.digest);
  expect(after.existing).toMatchObject({status:"failed",code:"web-image-search-not-configured"});
  expect(after.candidates).toEqual(before.candidates);expect(bodies).toHaveLength(2);
  expect(source).toHaveBeenCalledTimes(2);session.invalidate(true);
});
it.each(["model-provider-auth","model-capability-unverified","model-contract-rejected","model-refused"] as const)("does not reinterpret a fatal %s as an independent no-match",async code=>{
  const {session,mixedSource,bodies}=await mixedFixture();
  mixedSource.mockRejectedValueOnce(new VisualError(code));
  await expect(session.reviewBatch(offlineDraft(),0,3,"popular-text")).rejects.toThrow(code);
  expect(bodies).toHaveLength(0);session.invalidate(true);
});
it("mixed 429 retry skips the source and successful image, while cancellation strips source ownership",async()=>{
  const {session,mixedSource,sourceRelease,bodies}=await mixedFixture(async call=>call===2?new Response("",{status:429,headers:{"retry-after":"30"}}):imageResponse());
  const review=await session.reviewBatch(offlineDraft(),0,3,"popular-text");
  await session.startBatch(review.batchId,review.digest,0,true).work;
  const saved=session.batchStatus(review.batchId).candidates[0].operation.image!.assetId;
  localPaidLease.providerNextAt=0;
  await session.startBatch(review.batchId,review.digest,1,true).work;
  expect(session.batchStatus(review.batchId).candidates[0].operation.image!.assetId).toBe(saved);
  expect(bodies).toHaveLength(3);expect(mixedSource).toHaveBeenCalledTimes(1);
  session.invalidate();expect(sourceRelease).toHaveBeenCalledTimes(1);
  expect(session.batchStatus(review.batchId).existing).toMatchObject({status:"cancelled"});
  expect(session.batchStatus(review.batchId).existing).not.toHaveProperty("visual");
  session.invalidate(true);
});
it("long captions require manual text without truncating intent; explicit cartoon medium stays primary",async()=>{
  const {session}=await mixedFixture(),draft={...offlineDraft(),intent:"A cartoon of two detectives. "+"A".repeat(501)};
  const review=await session.reviewBatch(draft,0,3,"popular-text");
  expect(review.existing).toMatchObject({caption:"",captionOrigin:"manual-required"});
  expect(review.requests.every(r=>JSON.parse(JSON.parse(r.body).prompt.split("\n").at(-1)!).intent===draft.intent)).toBe(true);
  expect(()=>session.previewExisting(review.batchId,review.digest,"","Alex")).toThrow("generation-invalid-draft");
  session.invalidate(true);
});
it("binds three distinct briefs, text inspiration, all ten contexts and intent before serialized one-image calls",async()=>{
  const {session,source,bodies,messages}=fixture();
  messages.push(...Array.from({length:12},(_,i)=>({id:String(i),speaker:"Alex",text:"hello"})));
  const draft=offlineDraft();draft.intent="Two named fictional detectives, Sherlock Holmes and Watson, deciding between two exits.";
  draft.context=messages.map((m,i)=>({label:m.id,text:i<10?`Reviewed ${i}`:"EXCLUDED-SECRET",included:i<10}));
  const review=await session.reviewBatch(draft,2,3,"popular-text");
  expect(source).toHaveBeenCalledTimes(1);expect(bodies).toHaveLength(0);
  expect(new Set(review.requests.map(r=>JSON.parse(r.body).prompt))).toHaveProperty("size",3);
  const data=review.requests.map(r=>JSON.parse(JSON.parse(r.body).prompt.split("\n").at(-1)!));
  expect(new Set(data.map(d=>d.styleDirection)).size).toBe(3);
  for(const d of data){expect(d.intent).toBe(draft.intent);expect(d.context).toHaveLength(10);expect(d.publicTextInspiration.references[0].name).toBe("Two Buttons");}
  expect(JSON.stringify(review.requests)).not.toContain("EXCLUDED-SECRET");
  await expect(session.process(review.requests[0].operationId,review.requests[0].digest,true)).rejects.toThrow("generation-review-required");
  const started=session.startBatch(review.batchId,review.digest,0,true);
  const duplicate=session.startBatch(review.batchId,review.digest,0,true);expect(duplicate.work).toBeUndefined();
  await started.work;
  const status=session.batchStatus(review.batchId);expect(status.status).toBe("ready");expect(bodies).toHaveLength(3);
  expect(bodies).toEqual(review.requests.map(r=>r.body));
  expect(status.candidates.map(c=>c.attempts)).toEqual([1,1,1]);
  expect(status.candidates.every(c=>c.operation.image?.inspiration?.mode==="popular-text")).toBe(true);
  for(const candidate of status.candidates){
    const a=candidate.operation.image!,file=session.serve(a.assetId,"image");expect(file.bytes).toEqual(image);file.release();
  }
  const chosen=status.candidates[0].operation.image!;
  const preview=session.previewInsert(chosen.assetId,"image","Chosen","A fictional scene","Alex");
  expect(session.insert(preview.handle,"inserted").generated.assetId).toBe(chosen.assetId);
  session.invalidate();
  const kept=session.serve(chosen.assetId,"image");kept.release();
  expect(()=>session.serve(status.candidates[1].operation.image!.assetId,"image")).toThrow("generation-asset-unavailable");
  expect(()=>session.previewInsert(chosen.assetId,"image","","x","Alex")).toThrow("generation-stale");
  session.invalidate(true);
});
it("retains success on 429, honors actual backoff, and retries only failed or not-started candidates on a new authorization",async()=>{
  const {session,bodies}=fixture(async call=>call===2?new Response("",{status:429,headers:{"retry-after":"30"}}):
    imageResponse());
  const review=await session.reviewBatch(offlineDraft(),0,3,"none");
  await session.startBatch(review.batchId,review.digest,0,true).work;
  let status=session.batchStatus(review.batchId);expect(status.status).toBe("paused");
  expect(status.candidates.map(c=>c.operation.status)).toEqual(["ready","failed","reviewed"]);
  const retained=status.candidates[0].operation.image!.assetId;expect(bodies).toHaveLength(2);
  expect(()=>session.startBatch(review.batchId,review.digest,1,true)).toThrow("generation-cooling-down");
  expect(session.startBatch(review.batchId,review.digest,0,true).work).toBeUndefined();
  localPaidLease.providerNextAt=0;
  await session.startBatch(review.batchId,review.digest,1,true).work;
  status=session.batchStatus(review.batchId);expect(status.status).toBe("ready");
  expect(bodies).toHaveLength(4);expect(status.candidates.map(c=>c.attempts)).toEqual([1,2,1]);
  expect(bodies[1]).toBe(bodies[2]);expect(bodies.filter(body=>body===bodies[0])).toHaveLength(1);
  expect(status.candidates[0].operation.image!.assetId).toBe(retained);
  expect(session.startBatch(review.batchId,review.digest,1,true).work).toBeUndefined();
  session.invalidate(true);
});
it("cancel/edit prevents the next dispatch without freeing the physical lease or exposing late output",async()=>{
  let release!:()=>void;
  const {session,bodies,revise}=fixture(async()=>{await new Promise<void>(resolve=>{release=resolve;});return imageResponse();});
  const review=await session.reviewBatch(offlineDraft(),0,3,"none"),started=session.startBatch(review.batchId,review.digest,0,true);
  expect(bodies).toHaveLength(1);expect(localPaidLease.busy).toBe(true);
  revise();expect(localPaidLease.busy).toBe(true);expect(generatedWorkerLease.busy).toBe(true);
  expect(()=>session.startBatch(review.batchId,review.digest,1,true)).toThrow("generation-stale");
  release();await started.work;
  expect(bodies).toHaveLength(1);expect(localPaidLease.busy).toBe(false);expect(session.bytes()).toBe(0);
  expect(session.batchStatus(review.batchId).status).toBe("cancelled");
  expect(session.batchStatus(review.batchId).candidates.every(c=>!c.operation.image)).toBe(true);
});
it("rejects eleven included rows, bad count and missing authority before public fetch or paid dispatch",async()=>{
  const {session,source,messages,bodies}=fixture();
  messages.push(...Array.from({length:11},(_,i)=>({id:String(i),speaker:"A",text:"hello"})));
  const draft={...offlineDraft(),context:messages.map(m=>({label:m.id,text:m.text,included:true}))};
  await expect(session.reviewBatch(draft,0,3,"popular-text")).rejects.toThrow("local-context-limit");
  for(const count of [0,2,4,Infinity,"3"])await expect(session.reviewBatch(offlineDraft(),0,count,"popular-text")).rejects.toThrow("generation-invalid-draft");
  expect(source).not.toHaveBeenCalled();expect(bodies).toHaveLength(0);
  const review=await session.reviewBatch(offlineDraft(),0,1,"none");
  expect(()=>session.startBatch(review.batchId,"wrong",0,true)).toThrow();
  expect(()=>session.startBatch(review.batchId,review.digest,0,false)).toThrow();
  expect(()=>session.startBatch(review.batchId,review.digest,2,true)).toThrow();
  expect(bodies).toHaveLength(0);
});
it("fails explicitly on requested source failure; a separate explicit no-reference review makes no source call",async()=>{
  const {session,source,bodies}=fixture();source.mockRejectedValueOnce(new Error("meme-source-unavailable"));
  await expect(session.reviewBatch(offlineDraft(),0,3,"popular-text")).rejects.toThrow("meme-source-unavailable");
  expect(bodies).toHaveLength(0);
  const review=await session.reviewBatch({...offlineDraft(),output:"gif"},0,1,"none");
  await session.startBatch(review.batchId,review.digest,0,true).work;
  expect(source).toHaveBeenCalledTimes(1);expect(bodies).toHaveLength(1);
  expect(session.batchStatus(review.batchId).candidates[0].operation.animation?.method).toBe("generated-image-local-animation");
  expect(JSON.parse(bodies[0]).prompt).not.toContain("publicTextInspiration");
  session.invalidate(true);
});
it("preserves a specified style and varies treatment without changing named subjects or count",()=>{
  const draft={...offlineDraft(),intent:"Two fictional film detectives in a watercolor scene.",expression:{style:"light-comic" as const,intensity:"restrained" as const,reference:"No likeness"}};
  const values=(["reaction-sticker","light-comic","playful-doodle"] as const).map(treatment=>
    JSON.parse(buildCreativeBrief(draft,[],undefined,{treatment,inspiration}).prompt.split("\n").at(-1)!));
  expect(new Set(values.map(v=>v.styleDirection)).size).toBe(1);
  expect(new Set(values.map(v=>v.treatment)).size).toBe(3);
  expect(values.every(v=>v.intent===draft.intent&&v.expression.style==="light-comic")).toBe(true);
});
it("does not start another provider request before preceding local rendering physically finishes",async()=>{
  const {session,bodies}=fixture();let release!:()=>void;
  const ordinary=vi.mocked(generatedMedia).getMockImplementation()!;
  vi.mocked(generatedMedia).mockImplementationOnce(async(...args)=>{
    await new Promise<void>(resolve=>{release=resolve;});return ordinary(...args);
  });
  const review=await session.reviewBatch(offlineDraft(),0,3,"none"),started=session.startBatch(review.batchId,review.digest,0,true);
  await vi.waitFor(()=>expect(release).toBeTypeOf("function"));
  expect(bodies).toHaveLength(1);expect(localPaidLease.busy).toBe(true);expect(generatedWorkerLease.busy).toBe(true);
  release();await started.work;
  expect(bodies).toHaveLength(3);expect(session.batchStatus(review.batchId).status).toBe("ready");
  session.invalidate(true);
});
it("keeps three previously inserted artifacts while retaining every new batch candidate; capacity failure never evicts messages",async()=>{
  const {session,revise,source}=fixture();const inserted:string[]=[];
  for(let i=0;i<3;i++){
    const review=await session.reviewBatch(offlineDraft(),0,1,"none");await session.startBatch(review.batchId,review.digest,0,true).work;
    const visual=session.batchStatus(review.batchId).candidates[0].operation.image!;
    const preview=session.previewInsert(visual.assetId,"image","","original","Alex");session.insert(preview.handle,`old-${i}`);inserted.push(visual.assetId);revise();
  }
  const review=await session.reviewBatch(offlineDraft(),0,3,"popular-text");await session.startBatch(review.batchId,review.digest,0,true).work;
  const status=session.batchStatus(review.batchId);expect(status.status).toBe("ready");
  for(const id of [...inserted,...status.candidates.map(c=>c.operation.image!.assetId)]){const file=session.serve(id,"image");file.release();}
  const chosen=status.candidates[1].operation.image!,preview=session.previewInsert(chosen.assetId,"image","","chosen","Alex");
  session.insert(preview.handle,"new");revise();
  await expect(session.reviewBatch(offlineDraft(),0,3,"popular-text")).rejects.toThrow("generation-memory-limit");
  expect(source).toHaveBeenCalledTimes(1);
  for(const id of [...inserted,chosen.assetId]){const file=session.serve(id,"image");file.release();}
  session.invalidate(true);expect(session.bytes()).toBe(0);
});
it("renews only missing expired reviews on explicit retry without refetching inspiration or regenerating a success",async()=>{
  const {session,bodies,source}=fixture(async call=>call===2?new Response("",{status:429,headers:{"retry-after":"30"}}):imageResponse());
  const review=await session.reviewBatch(offlineDraft(),0,3,"popular-text");await session.startBatch(review.batchId,review.digest,0,true).work;
  const saved=session.batchStatus(review.batchId).candidates[0].operation.image!.assetId;
  const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+300_001);
  try{
    expect(()=>session.startBatch(review.batchId,review.digest,1,true)).toThrow("generation-review-required");
    const renewed=session.renewBatch(review.batchId,review.digest);
    expect(renewed.digest).not.toBe(review.digest);expect(renewed.requests).toHaveLength(2);expect(source).toHaveBeenCalledTimes(1);
    expect(bodies).toHaveLength(2);
    expect(()=>session.startBatch(review.batchId,review.digest,1,true)).toThrow("generation-review-required");
    await session.startBatch(renewed.batchId,renewed.digest,renewed.nextAttempt,true).work;
    expect(session.batchStatus(review.batchId).status).toBe("ready");expect(bodies).toHaveLength(4);
    expect(session.batchStatus(review.batchId).candidates[0].operation.image!.assetId).toBe(saved);
  }finally{clock.mockRestore();session.invalidate(true);}
});
it("never retries an uncertain dispatched completion when explicitly continuing the remaining queue",async()=>{
  const {session,bodies}=fixture(async call=>{if(call===1)throw new TypeError("OFFLINE disconnected transport");return imageResponse();});
  const review=await session.reviewBatch(offlineDraft(),0,3,"none");await session.startBatch(review.batchId,review.digest,0,true).work;
  expect(session.batchStatus(review.batchId).candidates[0].operation.status).toBe("unknown-after-dispatch");
  const renewed=session.renewBatch(review.batchId,review.digest);expect(renewed.requests).toHaveLength(2);
  await session.startBatch(renewed.batchId,renewed.digest,renewed.nextAttempt,true).work;
  expect(bodies).toHaveLength(3);expect(bodies.filter(body=>body===bodies[0])).toHaveLength(1);
  expect(session.batchStatus(review.batchId).candidates.map(c=>c.operation.status)).toEqual(["unknown-after-dispatch","ready","ready"]);
  session.invalidate(true);
});
