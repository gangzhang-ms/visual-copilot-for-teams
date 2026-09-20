import {mkdir,open,writeFile,readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {chromium} from "@playwright/test";
import sharp from "sharp";
import {buildRoot,builtUrl} from "./build-root.mjs";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const live=process.argv[2]==="--live-once";
if(!live&&process.argv[2]!=="--offline")throw new Error("Explicit canary mode required");
let modelKey=live?process.env.MODEL_API_KEY:"OFFLINE-MODEL",searchKey=live?process.env.SERPAPI_API_KEY:"OFFLINE-SEARCH";
delete process.env.MODEL_API_KEY;delete process.env.SERPAPI_API_KEY;
const directory=resolve(".local","visual-context",live?"contextual-quality-reply-live":"contextual-quality-reply-offline");
const report={live,startedAt:new Date().toISOString(),textCalls:0,imageCalls:0,searchCalls:0,thumbnailCalls:0,
  browserExternalRequests:0,passed:false,closed:false,phase:"preparation",requests:[],dispatched:{text:0,image:0,search:0,thumbnail:0}};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
let app,browser,context,page,owned,anchorReady=false;
const writes=[];
const check=(ok,code)=>{if(!ok)throw new Error(code);};
async function save(name,value){await writeFile(resolve(directory,name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));}
async function bounded(response,max){
  const chunks=[];let count=0;const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  try{while(true){const part=await reader.read();if(part.done)break;count+=part.value.length;check(count<=max,"response-bound");chunks.push(part.value);}return Buffer.concat(chunks);}
  finally{await reader.cancel();reader.releaseLock();}
}
function assertNoSecrets(value){
  check(![modelKey,searchKey].some(key=>key&&JSON.stringify(value).includes(key)),"secret-output-boundary");
}
try{
  check(modelKey&&searchKey,"credential-unavailable");
  check(buildRoot.endsWith("dist-chat-contextual-reply"),"wrong-build-root");
  await mkdir(directory,{recursive:true});
  report.build={root:buildRoot,serverSha256:hash(await readFile(resolve(buildRoot,"server","local-chat-server.js")))};
  if(live){
    try{
      const marker=await open(resolve(directory,"attempt.json"),"wx");
      try{await marker.writeFile(JSON.stringify({startedAt:report.startedAt,      maxText:2,maxImages:2,maxSearches:1,priorFeatureTextCalls:1,totalFeatureTextCeiling:3}));}finally{await marker.close();}
    }catch(error){
      if(error.code!=="EEXIST")throw error;
      const prior=JSON.parse(await readFile(resolve(directory,"report.json"),"utf8"));
      check(prior.textCalls===0&&prior.imageCalls===0&&prior.searchCalls===0&&prior.requests.length===0,"canary-already-consumed");
      await save("pre-dispatch-failure.json",prior);
    }
  }
  report.phase="imports";
  const {createLocalChatServer}=await import(builtUrl("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(builtUrl("personal-image.js"));
  const fixtureImage=live?null:await sharp({create:{width:1024,height:1024,channels:3,background:"#487"}}).png().toBuffer();
  const fixtureThumb=live?null:await sharp({create:{width:300,height:240,channels:3,background:"#354"}}).jpeg().toBuffer();
  async function modelTransport(url,init,image=false){
    const endpoint=new URL(String(url));
    check(endpoint.origin==="https://your-azure-openai-resource.openai.azure.com","model-origin");
    const index=image?++report.imageCalls:++report.textCalls;
    check(index<=2,"canary-model-budget");
    const request=JSON.parse(String(init.body)),payload=image?null:JSON.parse(request.messages[1].content[0].text);
    assertNoSecrets(request);
    await save(`${image?"image":"text"}-request-${index}.json`,request);
    if(image)check(anchorReady,"canary-anchor-unrecognized");
    if(payload?.task==="plan-contextual-expression"){
      const parts=request.messages[1].content.filter(c=>c.type==="image_url"),frames=[];
      for(const [i,part] of parts.entries()){
        const bytes=Buffer.from(part.image_url.url.split(",")[1],"base64"),meta=await sharp(bytes).metadata();
        await save(`actual-input-${i+1}.png`,bytes);
        frames.push({...payload.frames[i],width:meta.width,height:meta.height,sha256:hash(bytes)});
      }
      await save("frame-proof.json",{replyTo:payload.replyTo,context:payload.context,frames});
      check(frames.length===1&&frames[0].context===payload.replyTo,"wrong-reply-target");
    }
    const started=performance.now();
    let response;
    if(live){
      report.dispatched[image?"image":"text"]++;
      await save("report.json",report);
      response=await fetch(url,init);
    }
    else if(image)response=Response.json({data:[{b64_json:fixtureImage.toString("base64")}]});
    else{
      const value=payload.task==="plan-contextual-expression"
        ?{observedSources:payload.frames.map((_,i)=>i===0?"Gandalf":null),mode:"inherit",kind:"fictional",franchise:"The Lord of the Rings",characters:["Gandalf"],subject:"wizard",reaction:"exhausted",
          medium:"movie",visualStyle:"photographic",motif:"A weary wizard facing an endless task",subjectCount:1,certainty:"grounded",evidence:[payload.frames[0].id]}
        :{id:payload.catalog[0].id,reason:"Fictional movie reaction",kind:"reaction-meme",anchorMatch:"matched",reactionMatch:true};
      response=Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]});
    }
    const bytes=await bounded(response,image?20*1024*1024:128*1024);
    assertNoSecrets(bytes.toString("utf8"));
    await save(`${image?"image":"text"}-raw-response-${index}.json`,bytes);
    report.requests.push({kind:image?"image":"text",index,status:response.status,elapsedMs:Math.round(performance.now()-started),
      apiVersion:endpoint.searchParams.get("api-version")});
    if(response.ok){
      const data=JSON.parse(bytes.toString("utf8"));assertNoSecrets(data);
      if(image){
        for(const [i,item] of (data.data??[]).entries()){
          if(typeof item.b64_json==="string"){
            const png=Buffer.from(item.b64_json,"base64");
            await save(`image-provider-${index}-${i}.png`,png);
            await save(`image-provider-${index}-${i}-receipt.json`,{bytes:png.length,sha256:hash(png)});
          }
        }
      }else{
        await save(`text-response-${index}.json`,data);
        const value=JSON.parse(data.choices[0].message.content);
        if(payload.task==="plan-contextual-expression"){
          report.anchorPlan=value;
          report.visionFrames=request.messages[1].content.filter(c=>c.type==="image_url").length;
          const expectedWork=value.franchise?/lord.*rings|middle.?earth|tolkien|指环王|魔戒|中土/i.test(value.franchise)
            :value.characters.some(c=>/gandalf|甘道夫/i.test(c));
          anchorReady=value.kind==="fictional"&&value.certainty==="grounded"&&expectedWork;
          await save("anchor-plan.json",value);
          if(!anchorReady)report.failureCode="canary-anchor-unrecognized";
          check(anchorReady,"canary-anchor-unrecognized");
        }else report.selection=value;
      }
    }
    await save("report.json",report);
    return new Response(bytes,{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/json",
      ...(response.headers.get("retry-after")?{"retry-after":response.headers.get("retry-after")}:{})}});
  }
  report.phase="server-create";
  app=await createLocalChatServer(modelKey,{clientRoot:resolve(buildRoot,"client"),interaction:"direct-personal",creationChoices:true,
    mixedCreation:true,webCreation:true,contextualCreation:true,webProvider:"serpapi",webSearchKey:searchKey,
    cooldownMs:live?6100:0,catalogSource:"original-demo",transport:(url,init)=>modelTransport(url,init),
    memeTransport:async()=>{throw new Error("fallback-forbidden");},
    webSearchTransport:async(url,init)=>{
      check(anchorReady,"canary-anchor-unrecognized");
      const endpoint=new URL(String(url)),search=endpoint.origin==="https://serpapi.com"&&endpoint.pathname==="/search";
      check(init.redirect==="error"&&init.credentials==="omit","source-transport");
      if(search){
        check(++report.searchCalls<=1,"canary-search-budget");
        report.publicQuery=endpoint.searchParams.get("q");
      }else{
        check(++report.thumbnailCalls<=1,"canary-thumbnail-budget");
        check(!String(url).includes(searchKey)&&!JSON.stringify(init.headers).includes(searchKey),"image-key-boundary");
      }
      if(live){report.dispatched[search?"search":"thumbnail"]++;await save("report.json",report);}
      const response=live?await fetch(url,init):search?Response.json({search_metadata:{status:"Success"},images_results:[
        {title:"Gandalf exhausted reaction meme",link:"https://example.com/fictional-reaction",original:"https://example.com/fictional.jpg",
          thumbnail:"https://encrypted-tbn0.gstatic.com/images?q=tbn:fixture&s"}
      ]}):new Response(fixtureThumb,{headers:{"content-type":"image/jpeg"}});
      const bytes=await bounded(response,search?512*1024:1024*1024);
      report.requests.push({kind:search?"search":"thumbnail",status:response.status});
      if(response.ok&&search){
        const data=JSON.parse(bytes.toString("utf8"));
        const safe={status:data.search_metadata?.status,images_results:Array.isArray(data.images_results)?data.images_results.map(row=>({
          title:row.title,thumbnail:row.thumbnail,link:row.link,original:row.original
        })):[]};
        assertNoSecrets(safe);await save("public-search-results.json",safe);
      }else if(response.ok&&!search){await save("source-download.bin",bytes);report.sourceDownloadSha256=hash(bytes);}
      await save("report.json",report);
      return new Response(bytes,{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/json"}});
    },
    generation:{...ongoingPersonalGenerationOptions(),transport:(url,init)=>modelTransport(url,init,true)}
  });
  report.phase="listener";
  const origin=await app.start(0);report.phase="browser-start";browser=await chromium.launch({channel:"msedge"});
  context=await browser.newContext({viewport:{width:1440,height:1050}});page=await context.newPage();
  owned=ownedBrowserSession(page,origin);
  await page.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.browserExternalRequests++;return route.abort();}
    return route.continue();
  });
  page.on("response",response=>{
    const path=new URL(response.url()).pathname;
    if(path==="/local/generation/batch/review"&&response.ok()){
      writes.push(response.json().then(value=>{assertNoSecrets(value);return save("batch-review.json",value);}));
    }
  });
  await owned.start();await page.goto(origin+"/chat");
  report.phase="owned-demo";
  await page.getByRole("button",{name:"Start a demo conversation",exact:true}).click();
  await page.getByTestId("chat-message").filter({hasText:"Quite the little portal."}).waitFor();
  const sourceState=await page.evaluate(async()=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    return(await fetch("/local/state",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"})).json();
  });
  await save("owned-demo-context.json",{messages:sourceState.messages.map(m=>({id:m.id,speaker:m.speaker,text:m.text,
    demoMedia:m.demoMedia,attachment:m.attachment?{category:m.attachment.category}:undefined})),fixture:"assets/chat-demo/film-reference.png and owl-motion.gif"});
  await page.locator(".local-composer").getByRole("button",{name:"Help me express",exact:true}).click();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Work work. Exhausted by endless tasks.");
  const target=sourceState.messages.find(m=>m.demoMedia==="user-reference");
  check(target&&sourceState.messages.length===5,"wrong-reply-target");
  report.replyTarget={messageId:target.id,speaker:target.speaker,text:target.text};
  await page.locator(".creation-advanced > summary").click();
  await page.getByLabel("Visual context (optional override)",{exact:true}).selectOption(target.id);
  await page.locator(".reply-target-cue").waitFor();
  await page.locator(".creation-advanced > summary").click();
  await page.screenshot({path:resolve(directory,"before.png")});
  check(report.textCalls+report.imageCalls+report.searchCalls===0,"unexpected-mount-dispatch");
  if(live){
    const marker=await open(resolve(directory,"dispatch.json"),"wx");
    try{await marker.writeFile(JSON.stringify({startedAt:new Date().toISOString(),    maxText:2,maxImages:2,maxSearches:1,priorFeatureTextCalls:1,totalFeatureTextCeiling:3}));}finally{await marker.close();}
  }
  report.phase="dispatch";
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await page.waitForFunction(()=>{
    const generated=[...document.querySelectorAll(".generation-candidate:not(.existing-candidate)")];
    return generated.length===2&&generated.every(card=>card.querySelector("img"))||
      !document.querySelector(".generation-batch")&&document.querySelector('[role="alert"]');
  },{},{timeout:360000});
  await writes.reduce((p,task)=>p.then(()=>task),Promise.resolve());
  await page.screenshot({path:resolve(directory,"after.png")});
  const stateText=await page.locator(".generation-batch").textContent().catch(()=>"");
  report.uiState=stateText.slice(0,1800);
  const existing=page.locator(".existing-candidate img");
  if(await existing.count()){
    const path=await existing.getAttribute("src"),bytes=await(await page.request.get(origin+path)).body();
    await save("source-preview.png",bytes);report.sourcePreviewSha256=hash(bytes);
  }
  const rendered=page.locator(".generation-candidate:not(.existing-candidate) img");
  for(let i=0;i<await rendered.count();i++){
    const path=await rendered.nth(i).getAttribute("src");
    if(path?.startsWith("/"))await save(`image-preview-${i+1}.png`,await(await page.request.get(origin+path)).body());
  }
  check(report.textCalls>=1&&report.textCalls<=2&&report.imageCalls===2,"incomplete-request-count");
  check(stateText.includes("3 of 3 ready")||stateText.includes("2 of 3 ready"),"incomplete-ui");
  report.passed=true;
  report.visualQuality="requires-pixel-inspection";
}catch(error){
  const safe=new Set(["credential-unavailable","canary-anchor-unrecognized","canary-model-budget","canary-search-budget",
    "incomplete-request-count","incomplete-ui","wrong-build-root"]);
  report.failureCode??=error?.code==="EEXIST"?"canary-already-consumed":safe.has(error?.message)?error.message:"canary-incomplete";
  process.exitCode=1;
  if(typeof error?.code==="string"&&/^[A-Z_]{2,50}$/.test(error.code))report.runtimeCode=error.code;
  if(["TypeError","RangeError","SyntaxError"].includes(error?.name))report.runtimeClass=error.name;
}finally{
  await Promise.allSettled(writes);
  if(owned)try{report.closed=(await owned.close()).closed;}catch{report.cleanupFailed=true;}
  await context?.close();await browser?.close();await app?.close();
  modelKey=undefined;searchKey=undefined;
  report.finishedAt=new Date().toISOString();
  await mkdir(directory,{recursive:true});await save("report.json",report);
  console.log(JSON.stringify(report,null,2));
}
