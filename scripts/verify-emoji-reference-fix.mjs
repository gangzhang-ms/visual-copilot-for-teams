import {mkdir,open,readFile,writeFile,readdir} from "node:fs/promises";
import {resolve,relative,join} from "node:path";
import {createHash} from "node:crypto";
import {chromium,expect} from "@playwright/test";
import {buildRoot,builtUrl} from "./build-root.mjs";
import {ownedBrowserSession} from "./local-browser-session.mjs";
import sharp from "sharp";
const live=process.argv[2]==="--live-once";
const custom=process.argv[3]==="--custom";
if(!live&&process.argv[2]!=="--offline")throw new Error("Explicit acceptance mode required");
let key=process.env.MODEL_API_KEY;delete process.env.MODEL_API_KEY;delete process.env.SERPAPI_API_KEY;
const dir=resolve(".local","visual-context",custom?(live?"custom-emoji-demo-live":"custom-emoji-demo-offline"):live?"emoji-reference-fix-live":"emoji-reference-fix-offline");
const report={live,custom,startedAt:new Date().toISOString(),phase:"prepare",attempts:0,dispatched:0,forbiddenCalls:0,
  imageCalls:0,searchCalls:0,downloads:0,externalBrowserRequests:0,passed:false,closed:false,diagnostics:[]};
const hash=value=>createHash("sha256").update(value).digest("hex");
const check=(ok,code)=>{if(!ok)throw new Error(code);};
async function save(name,value){
  const bytes=Buffer.isBuffer(value)?value:JSON.stringify(value,null,2);
  check(!key||!bytes.toString().includes(key),"secret-boundary");
  await writeFile(resolve(dir,name),bytes);
}
let app,browser,page,owned;
try{
  check(key&&buildRoot.endsWith(custom?"dist-chat-custom-emoji-demo":"dist-chat-emoji-reference-fix"),"configuration");
  await mkdir(dir,{recursive:true});
  if(live){const marker=await open(resolve(dir,"attempt.json"),"wx");try{
    await marker.writeFile(JSON.stringify({at:report.startedAt,maxText:1,maxImages:0,maxSearch:0,maxDownloads:0}));
  }finally{await marker.close();}}
  const files=[];
  async function visit(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
    const path=join(folder,entry.name);if(entry.isDirectory())await visit(path);else{
      const bytes=await readFile(path);files.push({path:relative(buildRoot,path),bytes:bytes.length,sha256:hash(bytes)});
    }
  }}
  await visit(resolve(buildRoot,"client"));await visit(resolve(buildRoot,"server"));files.sort((a,b)=>a.path.localeCompare(b.path));
  report.build={root:buildRoot,sha256:hash(JSON.stringify(files))};await save("build-manifest.json",{...report.build,files});
  const {createLocalChatServer}=await import(builtUrl("local-chat-server.js"));
  const forbidden=async()=>{report.forbiddenCalls++;await save("report.json",report);throw new Error("forbidden-transport");};
  app=await createLocalChatServer(key,{clientRoot:resolve(buildRoot,"client"),interaction:"direct-personal",emojiExpressions:true,
    catalogSource:"original-demo",cooldownMs:live?6100:0,memeTransport:forbidden,webSearchTransport:forbidden,
    generation:{transport:forbidden},modelDiagnostic:event=>report.diagnostics.push(event),
    transport:async(url,init)=>{
      const endpoint=new URL(String(url));
      check(endpoint.origin==="https://your-azure-openai-resource.openai.azure.com"
        &&endpoint.pathname==="/openai/deployments/your-vision-deployment/chat/completions"
        &&endpoint.searchParams.get("api-version")==="2024-10-21","endpoint");
      check(++report.attempts===1,"one-call-budget");
      const request=JSON.parse(String(init.body)),parts=request.messages[1].content,payload=JSON.parse(parts[0].text);
      await save("request.json",request);
      check(payload.task==="explain"&&(custom
        ?parts.length===2&&payload.target.kind==="visual"&&payload.frames.length===1&&payload.context.length===7
        :parts.length===1&&payload.target.kind==="emoji"&&payload.target.emoji==="🙂"&&payload.frames.length===0&&payload.context.length===5),"owned-emoji-target");
      const schema=request.response_format.json_schema.schema.properties;
      if(custom){
        check(request.response_format.json_schema.name==="visual_explanation_v2"&&JSON.stringify(schema.observations.items.properties.frames.items.enum)==='["f0"]',"visual-contract");
        check(payload.target.source==="original-custom-emoji"&&payload.target.selectedContext==="c1"
          &&schema.background.properties.frames.maxItems===0&&JSON.stringify(schema.background.properties.source.enum)==="[null]","original-source-and-selection-contract");
        const bytes=Buffer.from(parts[1].image_url.url.split(",")[1],"base64"),metadata=await sharp(bytes).metadata();
        await save("actual-input.png",bytes);
        report.visionInputImages=1;report.frameProof={width:metadata.width,height:metadata.height,bytes:bytes.length,sha256:hash(bytes),requestId:payload.frames[0].id};
        check(metadata.width===384&&metadata.height===384,"native-analysis-size");
      }else check(JSON.stringify(schema.background.properties.source.enum)==="[null]"&&schema.observations.items.properties.frames.maxItems===0,"fixed-contract");
      report.apiVersion=endpoint.searchParams.get("api-version");await save("report.json",report);
      let response;const started=performance.now();
      if(live){report.dispatched++;await save("report.json",report);response=await fetch(url,init);}
      else response=Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        background:{source:null,context:null,frames:[]},observations:[{text:custom?"A yellow smiling face with a large blue droplet.":"Slightly smiling face.",frames:custom?["f0"]:[]}],
        commonUsage:["May be friendly, restrained or ironic."],contextualInterpretations:[
          {text:custom?"Offering another task with this image may convey mixed feelings.":"Keeping old bookmarks may signal cautious politeness.",context:[custom?"c1":"c3"]},
          {text:"It might also be a straightforward friendly remark.",context:custom?["c0","c1"]:["c0","c3"]}],
        uncertainties:["Tone varies with shared usage; no culture is inferred."],safeResponseGuidance:["Ask if they want to keep both options."]
      })}}]});
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;check(size<=64_000,"response-bound");chunks.push(part.value);}}
      finally{await reader.cancel();reader.releaseLock();}
      const bytes=Buffer.concat(chunks);await save("response.json",bytes);
      report.httpStatus=response.status;report.elapsedMs=Math.round(performance.now()-started);await save("report.json",report);
      if(response.ok){const parsed=JSON.parse(bytes.toString());await save("model-output.json",JSON.parse(parsed.choices[0].message.content));}
      return new Response(bytes,{status:response.status,headers:{"content-type":"application/json"}});
    }});
  const origin=await app.start(0);browser=await chromium.launch({channel:"msedge"});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});page=await context.newPage();page.setDefaultTimeout(60_000);
  owned=ownedBrowserSession(page,origin);await owned.start();
  await page.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalBrowserRequests++;return route.abort();}
    return route.continue();
  });
  await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  await page.getByRole("button",{name:custom?"Start emoji understanding demo":"Start a demo conversation",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(custom?7:5);
  const state=await page.evaluate(async()=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    return(await fetch("/local/state",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"})).json();
  });
  await save("owned-context.json",{messages:state.messages.map(m=>({id:m.id,speaker:m.speaker,text:m.text,demoMedia:m.demoMedia}))});
  if(custom){
    const bytes=Buffer.from(state.messages[1].attachment.dataUrl.split(",")[1],"base64"),metadata=await sharp(bytes).metadata();
    await save("source-original.png",bytes);
    const manifest=JSON.parse(await readFile(resolve("assets","emoji-demo","manifest.json"),"utf8"));
    await save("source-provenance.json",{origin:manifest.origin,...manifest.assets[0],selectedId:state.messages[1].id});
    check(hash(bytes)===manifest.assets[0].sha256&&metadata.width===384&&metadata.height===384,"original-source");
    const image=page.locator(".custom-emoji-icon").first();
    report.display=await image.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,naturalWidth:el.naturalWidth}));
    check(report.display.width===48&&report.display.height===48,"compact-display");
    await page.screenshot({path:resolve(dir,"compact-demo.png"),fullPage:true});
    await page.getByRole("button",{name:"Enlarge custom emoji",exact:true}).first().click();
    const dialog=page.getByRole("dialog",{name:"Custom emoji preview",exact:true});
    await expect(dialog).toBeVisible();await page.screenshot({path:resolve(dir,"enlarged-custom.png"),fullPage:true});
    await dialog.getByRole("button",{name:"Close",exact:true}).click();check(report.attempts===0,"no-automatic-inference");
  }
  report.phase="explain";
  const reviewPromise=page.waitForResponse(r=>r.url().endsWith("/local/review"));
  const processPromise=page.waitForResponse(r=>r.url().endsWith("/local/process"));
  const targetText=custom?"I can take the next one.":"I'll keep the old bookmarks. 🙂";
  await page.getByTestId("chat-message").filter({hasText:targetText}).getByRole("button",{name:"Explain",exact:true}).click();
  const reviewResponse=await reviewPromise,review=await reviewResponse.json();await save("review.json",review);
  const processed=await processPromise,result=await processed.json();await save("route-result.json",{status:processed.status(),result});
  await save("report.json",report);
  check(processed.ok()&&result.result?.status==="ready","explain-route-failed");
  await expect(page.locator(custom?".explanation-background":".explanation-common")).toBeVisible();
  await page.locator(".explanation-panel").getByText("View details",{exact:true}).click();
  await page.screenshot({path:resolve(dir,"actual-explanation.png"),fullPage:true});
  const explanation=result.result.explanation,selected=state.messages.find(m=>m.text===targetText);
  check(review.profileSpeaker==="Maya"&&review.input.speakerContext.profile===null
    &&(custom?review.input.explanationTarget.kind==="visual":review.input.explanationTarget.emoji==="🙂"),"selected-sender-binding");
  if(custom){
    const sample=review.media.samples[0],bytes=Buffer.from(sample.dataUrl.split(",")[1],"base64");
    check(review.media.samples.length===1&&sample.assetId===selected.id&&hash(bytes)===report.frameProof.sha256,"owned-native-pixel-binding");
    const original=await readFile(resolve(dir,"source-original.png"));
    check((await sharp(bytes).ensureAlpha().raw().toBuffer()).equals(await sharp(original).ensureAlpha().raw().toBuffer()),"exact-original-pixels");
    report.frameProof.originalDecodedPixelsEqual=true;
    check(explanation.observations.some(o=>o.frames.includes(sample.id)),"visual-observation-evidence");
    report.frameProof.assetId=sample.assetId;report.frameProof.reviewId=sample.id;await save("frame-proof.json",report.frameProof);
  }else check(explanation.background.source===null&&explanation.background.context===null&&explanation.background.frames.length===0
    &&explanation.observations.every(o=>o.frames.length===0),"no-pixel-evidence");
  const reviewedIds=review.input.context.filter(c=>c.included).map(c=>c.label);
  check(reviewedIds.includes(selected.id)&&explanation.contextualInterpretations.every(o=>o.context.every(id=>reviewedIds.includes(id))),"scope");
  check(report.attempts===1&&report.httpStatus===200&&report.forbiddenCalls===0&&report.externalBrowserRequests===0,"counts");
  report.passed=true;report.phase="complete";report.result=explanation;
}catch(error){report.failure={phase:report.phase,kind:error instanceof Error?error.name:"unknown"};process.exitCode=1;}
finally{
  if(page&&!report.passed)await page.screenshot({path:resolve(dir,"failure.png"),fullPage:true}).catch(()=>{report.screenshotFailed=true;});
  await save("report.json",report);
  if(owned)try{report.cleanup=await owned.close();report.closed=report.cleanup.closed;}catch{report.cleanupFailed=true;process.exitCode=1;}
  if(browser)await browser.close();if(app)await app.close();
  await save("report.json",report);key=null;
  console.log(JSON.stringify({passed:report.passed,live,attempts:report.attempts,dispatched:report.dispatched,httpStatus:report.httpStatus,
    imageCalls:0,searchCalls:0,downloads:0,closed:report.closed,evidence:dir}));
}
