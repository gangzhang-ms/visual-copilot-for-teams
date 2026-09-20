import {mkdir,open,readFile,writeFile} from "node:fs/promises";
import {resolve,basename} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {chromium,expect} from "@playwright/test";
import sharp from "sharp";
import {ownedBrowserSession} from "./local-browser-session.mjs";

// One explicitly authorized call on the existing listener. No key access or new server.
delete process.env.MODEL_API_KEY;delete process.env.SERPAPI_API_KEY;delete process.env.BRAVE_SEARCH_API_KEY;
const origin="http://127.0.0.1:4361",root=resolve("dist-chat-custom-emoji-demo");
const dir=resolve(".local","visual-context","custom-emoji-final-live");
const expectedBuild="5e19fefe5dda7596cdab43e00898fe1e1fcb5626dd5fef38a270dc85510be518";
const hash=(value,format="hex")=>createHash("sha256").update(value).digest(format);
const check=(ok,code)=>{if(!ok)throw new Error(code);};
const save=(name,value)=>writeFile(resolve(dir,name),Buffer.isBuffer(value)||typeof value==="string"?value:JSON.stringify(value,null,2));
const report={origin,startedAt:new Date().toISOString(),phase:"preflight",processAttempts:0,forwarded:0,
  forbiddenActions:0,externalBrowserRequests:0,imageGeneration:0,search:0,downloads:0,passed:false,closed:false};
let browser,page,owned,review,contractFailure;
await mkdir(dir,{recursive:true});
const marker=await open(resolve(dir,"attempt.json"),"wx");
try{await marker.writeFile(JSON.stringify({authorization:"One final additional TEXT+VISION Explain on repaired4361",at:report.startedAt,
  maxCalls:1,cumulativeTaskMax:3,noRetry:true}));}finally{await marker.close();}
try{
  const manifest=JSON.parse(await readFile(resolve(".local","visual-context","custom-emoji-demo-offline","build-manifest.json"),"utf8"));
  check(manifest.sha256===expectedBuild&&hash(JSON.stringify(manifest.files))===expectedBuild,"manifest-mismatch");
  for(const file of manifest.files)check(hash(await readFile(resolve(root,file.path)))===file.sha256,"build-drift");
  report.buildSha256=expectedBuild;await save("build-manifest.json",manifest);
  const serviceFile=manifest.files.find(f=>/^server[\\/]media-resolver-.*\.js$/.test(f.path));
  check(serviceFile,"compiled-service-missing");
  const {A:AnalysisService}=await import(pathToFileURL(resolve(root,serviceFile.path)).href);
  const {developmentSettings}=await import(pathToFileURL(resolve(root,"server","development-model.js")).href);
  async function verifyExactRequest(value){
    // Re-serialize only the immutable review using the exact compiled service.
    // Digest equality proves its bytes match the listener's authorized request.
    // Never invoke process(), a gateway, Graph, a transport, or a second model.
    const profile={...structuredClone(developmentSettings.profile),version:value.processing.profileVersion,
      validUntil:null,validity:"ongoing-personal",imageCap:2,explanationFormat:"json-schema",
      requestBytes:null,inputTokens:8500,contextTokens:9500};
    const session={version:value.input.version-1,binding:{commandId:"explainVisual"},media:structuredClone(value.media)};
    const service=new AnalysisService({invalidate:s=>{s.version++;}},{executionScope:"development-local",profile},null,null,null,[]);
    service.review(session,structuredClone(value.input));
    const body=session.requestBody;check(typeof body==="string","request-unavailable");
    await save("model-request.json",body);
    check(hash(body,"base64url")===value.processing.digest,"review-digest-mismatch");
    const parsed=JSON.parse(body),parts=parsed.messages[1].content,payload=JSON.parse(parts[0].text);
    const schema=parsed.response_format.json_schema.schema.properties;
    check(parts.length===2&&payload.frames.length===1&&payload.context.length===7
      &&payload.target.source==="original-custom-emoji"&&payload.target.selectedContext==="c1","selected-image-contract");
    check(JSON.stringify(schema.background.properties.source.enum)==="[null]"
      &&JSON.stringify(schema.background.properties.context.enum)==="[null]"&&schema.background.properties.frames.maxItems===0
      &&JSON.stringify(schema.observations.items.properties.frames.items.enum)==='["f0"]',"repaired-provenance-contract");
    check(payload.context[1].text==="Maya: I can take the next one.","selected-text");
    const bytes=Buffer.from(parts[1].image_url.url.split(",")[1],"base64");
    await save("actual-input.png",bytes);
    const original=await readFile(resolve("assets","emoji-demo","icon-01.png")),metadata=await sharp(bytes).metadata();
    await save("source-original.png",original);
    check(metadata.width===384&&metadata.height===384,"frame-dimensions");
    check((await sharp(original).ensureAlpha().raw().toBuffer()).equals(await sharp(bytes).ensureAlpha().raw().toBuffer()),"pixel-mismatch");
    report.requestProof={method:"Exact compiled AnalysisService.review reserialization; SHA256-base64url equals actual server review digest",
      digest:value.processing.digest,bytes:Buffer.byteLength(body),selectedContext:"c1",visionInputs:1,
      originalSha256:hash(original),transmittedSha256:hash(bytes),decodedPixelsEqual:true,width:384,height:384};
    await save("request-proof.json",report.requestProof);
  }
  browser=await chromium.launch({channel:"msedge"});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});page=await context.newPage();page.setDefaultTimeout(60_000);
  owned=ownedBrowserSession(page,origin);await owned.start();
  report.health=await(await page.request.get(origin+"/healthz")).json();
  check(report.health.ready&&report.health.model,"listener-unready");
  for(const file of manifest.files.filter(f=>/^client[\\/]assets[\\/].*\.(js|css)$/.test(f.path))){
    const response=await page.request.get(origin+"/assets/"+basename(file.path));
    check(response.ok()&&hash(await response.body())===file.sha256,"served-asset-drift");
  }
  const html=manifest.files.find(f=>f.path===["client","local-chat.html"].join("\\"));
  check(html&&hash(await(await page.request.get(origin+"/chat")).body())===html.sha256,"served-html-drift");
  await page.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalBrowserRequests++;return route.abort();}
    if(/^\/local\/(?:emoji\/suggest|catalog\/load|generation\/)/.test(url.pathname)){
      report.forbiddenActions++;return route.abort();
    }
    if(url.pathname==="/local/review"&&request.method()==="POST"){
      await save("review-request.json",request.postDataJSON());
      // This endpoint is local preparation only, never inference.
      const response=await route.fetch({maxRetries:0});review=await response.json();
      await save("review-response.json",{status:response.status(),body:review});
      return route.fulfill({response});
    }
    if(url.pathname==="/local/process"&&request.method()==="POST"){
      report.processAttempts++;await save("process-request.json",request.postDataJSON());
      try{
        check(report.processAttempts===1&&review?.processing,"one-call-guard");
        await verifyExactRequest(review);
        report.forwarded++;report.processStartedAt=new Date().toISOString();await save("report.json",report);
        return route.continue();
      }catch(error){
        contractFailure=error instanceof Error?error.message:"request-contract";await save("pre-dispatch-failure.json",{code:contractFailure});
        return route.abort();
      }
    }
    return route.continue();
  });
  await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  async function state(){
    return page.evaluate(async()=>{
      const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
      return(await fetch("/local/state",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"})).json();
    });
  }
  const before=await state();report.providerRequestsBefore=before.providerRequests;
  await page.getByRole("button",{name:"Start emoji understanding demo",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(7);
  const source=await state(),selected=source.messages[1];
  await save("owned-context.json",{messages:source.messages.map(m=>({id:m.id,speaker:m.speaker,text:m.text,demoMedia:m.demoMedia}))});
  check(selected.speaker==="Maya"&&selected.text==="I can take the next one."&&selected.demoMedia==="custom-emoji","owned-selection");
  check(source.providerRequests===before.providerRequests,"unexpected-pre-call");
  report.phase="explain";
  const pending=page.waitForResponse(r=>r.url()===origin+"/local/process",{timeout:90_000});
  const started=performance.now();
  await page.getByTestId("chat-message").filter({hasText:"I can take the next one."}).getByRole("button",{name:"Explain",exact:true}).click();
  const response=await pending,bytes=await response.body();
  await save("process-response.json",bytes);
  report.routeStatus=response.status();report.routeLatencyMs=Math.round(performance.now()-started);await save("report.json",report);
  const result=JSON.parse(bytes.toString());await save("result.json",result);
  check(response.ok()&&result.result?.status==="ready"&&result.result.kind==="explanation","explanation-not-ready");
  const explanation=result.result.explanation;await save("validated-model-output.json",explanation);
  check(review.input.explanationTarget.contextLabel===selected.id&&review.profileSpeaker==="Maya","review-owner-binding");
  const sample=review.media.samples[0],primary=explanation.contextualInterpretations[0];
  check(sample.assetId===selected.id&&review.media.samples.length===1,"pixel-owner-binding");
  check(explanation.background.source===null&&explanation.background.context===null&&explanation.background.frames.length===0,"background-consistency");
  check(explanation.observations.some(o=>o.frames.includes(sample.id))&&explanation.observations.every(o=>o.frames.every(id=>id===sample.id)),"frame-evidence");
  check(primary.context.includes(selected.id)&&!primary.context.includes(source.messages[6].id),"selected-not-later-reference");
  check(/take|next|task|volunteer|offer|work|responsib|willing/i.test(primary.text)
    &&!/thanks? .*(making|room)|after .*(thanks|making room)/i.test(primary.text),"selected-not-later-meaning");
  const ids=review.input.context.filter(c=>c.included).map(c=>c.label);
  check(explanation.contextualInterpretations.every(item=>item.context.every(id=>ids.includes(id))),"context-scope");
  await expect(page.locator(".explanation-panel")).toBeVisible();
  await page.locator(".explanation-panel").getByText("View details",{exact:true}).click();
  await page.screenshot({path:resolve(dir,"actual-explanation.png"),fullPage:true});
  const after=await state();report.providerRequestsAfter=after.providerRequests;
  check(after.providerRequests-before.providerRequests===1&&report.forwarded===1&&report.processAttempts===1
    &&report.forbiddenActions===0&&report.externalBrowserRequests===0,"actual-call-count");
  report.result=explanation;report.binding={selectedId:selected.id,requestLocalId:"c1",actualFrameId:sample.id,
    primaryContext:primary.context,selectedMeaningCheck:true};
  report.responseProvenance="Actual4361 /local/process HTTP response and validated model content. Raw Azure HTTP envelope is not exposed by the unchanged running server.";
  report.passed=true;report.phase="complete";
}catch(error){
  report.failure={phase:report.phase,code:contractFailure??(error instanceof Error?error.message:"unknown")};process.exitCode=1;
}finally{
  await save("report.json",report);
  if(page&&!report.passed)await page.screenshot({path:resolve(dir,"failure.png"),fullPage:true}).catch(()=>{report.screenshotFailed=true;});
  if(owned)try{report.cleanup=await owned.close();report.closed=report.cleanup.closed;}catch{report.cleanupFailed=true;process.exitCode=1;}
  if(browser)await browser.close();
  await save("report.json",report);
  console.log(JSON.stringify({passed:report.passed,forwarded:report.forwarded,routeStatus:report.routeStatus,latencyMs:report.routeLatencyMs,
    buildSha256:report.buildSha256,closed:report.closed,evidence:dir}));
}
