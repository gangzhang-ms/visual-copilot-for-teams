import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { buildRoot, builtUrl } from "./build-root.mjs";
const {personalAllowance,personalGenerationOptions,personalCanaryDraft,recordPersonalCanary,personalImageAuthorization}=await import(builtUrl("personal-image.js"));
const {createLocalChatServer}=await import(builtUrl("local-chat-server.js"));
export async function runPersonalImage(mode,key){
  const ledger=personalAllowance();
  if(mode==="imageinit"){
    ledger.initialize();process.stdout.write("Personal image grant initialized without replenishment: 1 canary + 3 ordinary attempts; expires 2026-09-15 16:59:43 +08.\n");return;
  }
  if(mode==="imagestatus"){
    process.stdout.write(JSON.stringify({authorization:personalImageAuthorization,canary:ledger.status("canary"),ordinary:ledger.status("ordinary")},null,2)+"\n");return;
  }
  if(mode==="imagechat"){
    const port=Number(process.env.LOCAL_CHAT_PORT??4319);
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("generation-invalid-port");
    const app=await createLocalChatServer(key,{clientRoot:resolve(buildRoot,"client"),generation:personalGenerationOptions("ordinary")});
    const origin=await app.start(port);
    process.stdout.write(`Personal image chat ready: ${origin}/chat; PID ${process.pid}; durable remaining ${ledger.status("ordinary").remaining}; per-request paid consent required.\n`);
    for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>{void app.close().then(()=>process.exit(0));});return;
  }
  if(mode!=="imagecanary")throw new Error("generation-invalid-mode");
  const initial=ledger.status("canary");
  if(initial.reason!=="available")throw new Error(initial.reason);
  const app=await createLocalChatServer(key,{clientRoot:resolve(buildRoot,"client"),generation:personalGenerationOptions("canary")});
  const origin=await app.start(0),started=performance.now(),rssStart=process.memoryUsage().rss,cpuStart=process.cpuUsage();
  let peakRss=rssStart,csrf="",cookie="",result,metrics={},imageBytes=0,normalized=false,inserted=false,previewed=false,errorCode;
  const sample=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},5);
  async function post(route,body={}){
    const response=await fetch(origin+"/local/"+route,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{"X-Local-CSRF":csrf}:{})},body:JSON.stringify(body)});
    const value=await response.json();cookie=response.headers.get("set-cookie")?.split(";")[0]??cookie;
    if(!response.ok)throw new Error(/^generation-[a-z-]+$/.test(value.code??"")?value.code:"generation-canary-local-path-failed");
    return value;
  }
  try{
    const room=await post("session");csrf=room.csrf;
    const review=await post("generation/review",{revision:room.revision,draftRevision:1,draft:personalCanaryDraft});
    const operation=await app.operatorCanary(csrf,review.operationId,review.digest);result=operation.result;metrics=operation.metrics;
    if(result.status!=="ready"||!result.image)throw new Error(result.code??"generation-canary-output-failed");
    const image=await fetch(origin+result.image.mediaUrl,{headers:{Cookie:cookie,Origin:origin}});
    const bytes=Buffer.from(await image.arrayBuffer());imageBytes=bytes.length;
    if(image.status!==200||image.headers.get("content-type")!=="image/png"||bytes.readUInt32BE(16)!==512||bytes.readUInt32BE(20)!==512)throw new Error("generation-canary-png-invalid");
    const preview=await post("generation/preview",{revision:review.revision,assetId:result.image.assetId,variant:"image",caption:"Original synthetic image canary",alt:"Original geometric welcome illustration; synthetic validation",speaker:"Synthetic tester"});previewed=!!preview.handle;
    const state=await post("generation/insert",{revision:review.revision,handle:preview.handle});inserted=state.messages.length===1&&!!state.messages[0].generated;
    const message=state.messages[0];
    const explanation=await post("review",{revision:state.revision,selectedId:message.id,command:"explainVisual",
      input:{intent:"Inspect this original synthetic illustration.",context:[{label:message.id,text:message.text,included:true}],
        preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}}});
    normalized=explanation.generatedSource?.analysisSide===128&&explanation.media.samples.length===1&&explanation.media.samples.every(s=>s.width===128&&s.height===128);
  }catch(error){errorCode=/^generation-[a-z-]+$/.test(error?.message??"")?error.message:"generation-canary-local-path-failed";}
  finally{
    clearInterval(sample);peakRss=Math.max(peakRss,process.memoryUsage().rss);
    if(csrf)try{await post("reset");}catch{errorCode??="generation-canary-cleanup-failed";}
    await app.close();
  }
  const report={
    authorizationId:personalImageAuthorization.authorizationId,recordedAt:new Date().toISOString(),scope:"personal-local-images",
    apiVersion:"2025-04-01-preview",model:"gpt-image-1.5",modelVersion:"2025-12-16",deployment:"your-image-deployment",
    providerRequests:app.generationCounters.providerRequests,decoderRequests:app.counters.providerRequests,graphRequests:app.counters.graphRequests,
    ...metrics,httpElapsedMs:metrics.elapsedMs,canonicalBytes:imageBytes,canonicalSide:512,analysisSide:128,previewed,inserted,normalized,
    elapsedMs:Math.round(performance.now()-started),rssStart,peakRss,rssGrowth:peakRss-rssStart,cpuMicros:process.cpuUsage(cpuStart),
    cleanup:app.resources(),...(errorCode?{errorCode}:{}),
    allPassed:!errorCode&&app.generationCounters.providerRequests===1&&app.counters.providerRequests===0&&app.counters.graphRequests===0
      &&metrics.httpStatus===200&&metrics.sourceWidth===1024&&metrics.sourceHeight===1024&&metrics.sourceBytes>0&&metrics.sourceBytes<=8*1024*1024
      &&metrics.canonicalWorker?.isolatedEnvironment===true&&imageBytes>0&&imageBytes<=1024*1024&&normalized&&previewed&&inserted
      &&peakRss-rssStart<384*1024*1024&&app.resources().generatedBytes===0&&!app.resources().nativeBusy,
    limitations:"One original synthetic PNG, not semantic/cultural or production certification. Sampled RSS is not a hard native limit. Programmatic exact-preview/manual-insert route validation is not human output approval. No native GIF/video generation."
  };
  // Record a dispatched failure too; there is no retry and no refund.
  if(report.providerRequests>0)recordPersonalCanary(report);
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
  if(!report.allPassed)throw new Error("generation-canary-failed-no-retry");
}
