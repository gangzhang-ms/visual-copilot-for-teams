import {expect,test,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import type {LocalGenerationBatchReview} from "../../src/shared/local-chat";
import {offlineDraft} from "../../src/server/generation.test.support";
import {openCreate,openCreationOptions} from "../expression-ui";
let app:Awaited<ReturnType<typeof Factory>>,origin:string,clock:number;
let calls:{url:string;body:string}[],sourceCalls:{url:string;init?:RequestInit}[];
let failAt:number,holdAt:number,sourceFailure:boolean,holdSource:boolean,release:(()=>void)|undefined,releaseSource:(()=>void)|undefined;
const realNow=Date.now,root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
const intent="Two fictional detectives, Sherlock Holmes and Watson, facing two choices in a playful dilemma.";
test.beforeEach(async()=>{
  clock=realNow();Date.now=()=>clock;calls=[];sourceCalls=[];failAt=0;holdAt=0;sourceFailure=false;holdSource=false;release=undefined;releaseSource=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));
  expect(localPaidLease.busy).toBe(false);localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const images=await Promise.all(["#a34b54","#479286","#487bbb"].map(color=>sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#eeeecc"/><circle cx="360" cy="400" r="230" fill="${color}"/><rect x="480" y="540" width="290" height="230" fill="#662244"/></svg>`
  )).png().toBuffer()));
  app=await createLocalChatServer("OFFLINE-BATCH-ROUTES",{
    clientRoot:resolve(root,"client"),interaction:"direct-personal",creationChoices:true,catalogSource:"original-demo",
    transport:async()=>{throw new Error("No text model is authorized in these tests");},
    memeTransport:async(url,init)=>{
      sourceCalls.push({url:String(url),init});
      if(holdSource)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,20_000);releaseSource=()=>{clearTimeout(timer);resolve();};});
      if(sourceFailure)return new Response("",{status:503});
      return new Response(JSON.stringify({success:true,data:{memes:Array.from({length:15},(_,i)=>({
        id:i===14?"87743020":String(100+i),name:i===14?"Two Buttons":`Fixture ${i}`,
        url:`https://i.imgflip.com/a${i}.png`,width:300,height:300,box_count:2
      }))}}),{headers:{"Content-Type":"application/json"}});
    },
    generation:{...ongoingPersonalGenerationOptions(),transport:async(url,init)=>{
      calls.push({url:String(url),body:String(init?.body)});const call=calls.length;
      expect(app.resources()).toMatchObject({paidBusy:true,nativeBusy:true});
      if(call===holdAt)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,20_000);release=()=>{clearTimeout(timer);resolve();};});
      if(call===failAt)return new Response("",{status:429,headers:{"retry-after":"30"}});
      return new Response(JSON.stringify({data:[{b64_json:images[(call-1)%3].toString("base64")}]}),{headers:{"Content-Type":"application/json"}});
    }}
  });origin=await app.start(0);
});
test.afterEach(async()=>{release?.();releaseSource?.();try{await app.close();}finally{Date.now=realNow;}});
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const session=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const noRevision=["state","cancel","session/close","generation/status","generation/process","generation/batch/status","generation/batch/process"];
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
      body:JSON.stringify(noRevision.includes(path)?body:{revision:session.revision,...body})});
    return {status:response.status,value:await response.json()};
  },{path,body});
}
async function open(page:Page,language:"en"|"zh-CN"="en"){
  await page.clock.setFixedTime(clock);await page.setViewportSize({width:1440,height:950});await page.goto(origin+"/chat");
  if(language!=="en")await page.getByLabel("Language / 语言").selectOption(language);
  await openCreate(page,language,false);
  await page.getByLabel(language==="en"?"What would you like to express?":"你想表达什么？",{exact:true}).fill(intent);
}
async function generate(page:Page,label="Generate 3 options"):Promise<LocalGenerationBatchReview>{
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/batch/review");
  await page.getByRole("button",{name:label,exact:true}).click();
  const value=await response;expect(value.status()).toBe(200);return value.json();
}
test("one click binds real public metadata to three progressive fresh requests and manually inserts the exact chosen candidate",async({page})=>{
  await open(page);
  expect(calls).toHaveLength(0);expect(sourceCalls).toHaveLength(0);
  holdAt=2;const review=await generate(page);
  await expect.poll(()=>calls.length).toBe(2);
  const batch=page.getByRole("region",{name:"Generated options",exact:true});
  await expect(batch.locator(".generation-candidate")).toHaveCount(3);
  await expect(batch).toContainText("1 of 3 ready");
  const first=await api(page,"generation/batch/status",{batchId:review.batchId});
  const firstAsset=first.value.candidates[0].operation.image;
  expect(firstAsset.inspiration.references[0].name).toBe("Two Buttons");
  expect((await api(page,"generation/batch/process",{batchId:review.batchId,digest:review.digest,attempt:0,consent:true})).status).toBe(200);
  expect(calls).toHaveLength(2);
  await batch.getByRole("button",{name:"Choose this option",exact:true}).click();
  await expect(page.getByRole("button",{name:"Preview generated insertion",exact:true})).toBeDisabled();
  release?.();await expect(batch).toContainText("3 of 3 ready");
  await expect(page.getByRole("button",{name:"Preview generated insertion",exact:true})).toBeEnabled();
  expect(calls.map(call=>call.body)).toEqual(review.requests.map(request=>request.body));
  const payloads=calls.map(call=>JSON.parse(call.body));
  expect(new Set(payloads.map(value=>JSON.parse(value.prompt.split("\n").at(-1)).styleDirection)).size).toBe(3);
  for(const payload of payloads){
    expect(Object.keys(payload).sort()).toEqual(["n","output_format","prompt","quality","size"]);
    const input=JSON.parse(payload.prompt.split("\n").at(-1));
    expect(input.intent).toBe(intent);expect(input.publicTextInspiration.references[0].name).toBe("Two Buttons");
    expect(payload.prompt).toContain("not source pixels");
  }
  expect(sourceCalls).toHaveLength(1);expect(sourceCalls[0].url).toBe("https://api.imgflip.com/get_memes");
  expect(sourceCalls[0].init).toMatchObject({method:"GET",redirect:"error",credentials:"omit"});
  expect(JSON.stringify(sourceCalls)).not.toContain(intent);expect(sourceCalls[0].init?.body).toBeUndefined();
  expect(app.memeCounters.imageRequests).toBe(0);expect(app.counters.providerRequests).toBe(0);
  await page.getByLabel("Local output caption",{exact:true}).fill("My chosen option");
  await page.getByRole("button",{name:"Preview generated insertion",exact:true}).click();
  await page.getByRole("button",{name:"Insert generated visual locally",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
  const state=(await api(page,"state")).value;
  expect(state.messages[0].generated.assetId).toBe(firstAsset.assetId);
  expect(state.messages[0].generated.digest).toBe(firstAsset.digest);
  expect(state.messages[0].generated.inspiration.references[0].name).toBe("Two Buttons");
  expect(calls).toHaveLength(3);
});
for(const language of ["en","zh-CN"] as const)test(`429 keeps completed options and explicit retry skips them in ${language}`,async({page})=>{
  await open(page,language);failAt=2;
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const review=await generate(page,t("Generate 3 options","生成 3 个方案"));
  const batch=page.locator(".generation-batch");
  const retry=page.getByRole("button",{name:t("Retry failed / not-started options only","仅重试失败或尚未开始的方案"),exact:true});
  await expect(retry).toBeVisible();await expect(retry).toBeDisabled();expect(calls).toHaveLength(2);
  const before=(await api(page,"generation/batch/status",{batchId:review.batchId})).value;
  expect(before.candidates.map((c:{operation:{status:string}})=>c.operation.status)).toEqual(["ready","failed","reviewed"]);
  const retained=before.candidates[0].operation.image.assetId;
  clock+=30_000;await page.clock.setFixedTime(clock);await expect(retry).toBeEnabled();
  expect(calls).toHaveLength(2);await retry.click();
  await expect(batch).toContainText(t("3 of 3 ready","3 个方案中已有 3 个就绪"));
  const after=(await api(page,"generation/batch/status",{batchId:review.batchId})).value;
  expect(calls).toHaveLength(4);expect(sourceCalls).toHaveLength(1);
  expect(after.candidates[0].operation.image.assetId).toBe(retained);
  expect(after.candidates.map((c:{attempts:number})=>c.attempts)).toEqual([1,2,1]);
  expect(calls[1].body).toBe(calls[2].body);expect(calls.filter(call=>call.body===calls[0].body)).toHaveLength(1);
  await page.setViewportSize({width:320,height:950});await batch.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:resolve(".local","visual-context",`create-options-${language}-mobile-mock.png`)});
});
test("source failure spends zero image calls, then an explicit no-reference click succeeds without refetching",async({page})=>{
  await open(page);sourceFailure=true;
  await page.getByRole("button",{name:"Generate 3 options",exact:true}).click();
  const fallback=page.getByRole("button",{name:"Generate without online inspiration",exact:true});
  await expect(fallback).toBeVisible();expect(calls).toHaveLength(0);expect(sourceCalls).toHaveLength(1);
  await fallback.click();await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
  expect(calls).toHaveLength(3);expect(sourceCalls).toHaveLength(1);
  expect(calls.every(call=>!call.body.includes("publicTextInspiration"))).toBe(true);
});
test("mode change while provider is held cancels remaining work and does not release physical leases early",async({page,browser})=>{
  await open(page);holdAt=2;const review=await generate(page);
  await expect.poll(()=>calls.length).toBe(2);
  await page.getByRole("radio",{name:"Find an existing image",exact:true}).check();
  await expect.poll(async()=>(await api(page,"generation/batch/status",{batchId:review.batchId})).value.status).toBe("cancelled");
  expect(app.resources()).toMatchObject({paidBusy:true,nativeBusy:true});
  const other=await browser.newContext(),otherPage=await other.newPage();await otherPage.goto(origin+"/chat");
  expect((await api(otherPage,"generation/batch/status",{batchId:review.batchId})).status).toBe(400);
  expect((await api(otherPage,"generation/batch/review",{draft:offlineDraft(),draftRevision:0,count:3,referenceMode:"popular-text"})).status).toBe(400);
  expect(sourceCalls).toHaveLength(1);expect(calls).toHaveLength(2);
  release?.();await expect.poll(()=>app.resources().paidBusy).toBe(false);
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await expect(page.locator(".generation-candidate")).toHaveCount(0);expect(calls).toHaveLength(2);
  const old=await api(page,"generation/batch/process",{batchId:review.batchId,digest:review.digest,attempt:1,consent:true});
  expect(old.status).toBe(400);expect(calls).toHaveLength(2);
  await other.close();
});
test("editing during source review prevents any image dispatch and closing an in-flight room prevents later candidates",async({page})=>{
  await open(page);holdSource=true;
  await page.getByRole("button",{name:"Generate 3 options",exact:true}).click();
  await expect.poll(()=>sourceCalls.length).toBe(1);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("An edited original idea");
  holdSource=false;releaseSource?.();
  await expect(page.getByRole("button",{name:"Generate 3 options",exact:true})).toBeEnabled();
  expect(calls).toHaveLength(0);
  holdAt=1;await generate(page);await expect.poll(()=>calls.length).toBe(1);
  expect((await api(page,"session/close")).value.closed).toBe(true);
  expect(app.resources().paidBusy).toBe(true);
  release?.();await expect.poll(()=>app.resources().paidBusy).toBe(false);
  expect(calls).toHaveLength(1);expect(app.resources().generatedBytes).toBe(0);
});
test("server rejects eleven included rows, foreign and stale snapshots, and individual dispatch of batch members",async({page})=>{
  await open(page);
  for(let i=0;i<11;i++)expect((await api(page,"message",{speaker:"Alex",text:`Context ${i}`})).status).toBe(200);
  const state=(await api(page,"state")).value,draft={...offlineDraft(),context:state.messages.map((m:{id:string;text:string})=>({label:m.id,text:m.text,included:true}))};
  expect((await api(page,"generation/batch/review",{draft,draftRevision:0,count:3,referenceMode:"popular-text"})).value.code).toBe("local-context-limit");
  expect(calls).toHaveLength(0);expect(sourceCalls).toHaveLength(0);
  draft.context[10].included=false;
  await api(page,"speaker/profile",{speaker:"Alex",profile:{language:"zh-CN",culture:"Voluntary fiction only",familiarity:"",tone:"Gentle",humor:"",avoid:""}});
  const prepared=await api(page,"generation/batch/review",{draft,draftRevision:0,count:3,referenceMode:"popular-text"});
  expect(prepared.status).toBe(200);const review:LocalGenerationBatchReview=prepared.value;
  for(const request of review.requests){
    const payload=JSON.parse(JSON.parse(request.body).prompt.split("\n").at(-1));
    expect(payload.context).toHaveLength(10);expect(payload.speakerContext).toMatchObject({role:"outgoing-speaker",profile:{language:"zh-CN",tone:"Gentle"}});
    expect(payload.requesterOrAudiencePreferences.language).toBe("en");
  }
  expect(JSON.stringify(sourceCalls)).not.toContain("Voluntary fiction only");
  const raw=await api(page,"generation/process",{operationId:review.requests[0].operationId,digest:review.requests[0].digest,consent:true});
  expect(raw.status).toBe(400);expect(calls).toHaveLength(0);
  expect((await api(page,"generation/batch/process",{batchId:review.batchId,digest:"wrong",attempt:0,consent:true})).status).toBe(400);
  await api(page,"cancel");
  expect((await api(page,"generation/batch/process",{batchId:review.batchId,digest:review.digest,attempt:0,consent:true})).status).toBe(400);
  expect((await api(page,"state")).value.messages).toHaveLength(11);expect(calls).toHaveLength(0);
});
test("single option and local GIF remain available with no pixels supplied or extra AI request",async({page})=>{
  await open(page);await openCreationOptions(page);
  await page.getByLabel("Number of options",{exact:true}).selectOption("1");
  await page.getByRole("radio",{name:"Find an existing image",exact:true}).check();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await openCreationOptions(page);await expect(page.getByLabel("Number of options",{exact:true})).toHaveValue("1");
  expect(sourceCalls).toHaveLength(0);expect(calls).toHaveLength(0);
  await page.getByLabel("Expression style",{exact:true}).selectOption("light-comic");
  await page.getByLabel("Requested output",{exact:true}).selectOption("gif");
  const review=await generate(page,"Generate 1 GIF option");
  await expect(page.locator(".generation-batch")).toContainText("1 of 1 ready");
  const status=(await api(page,"generation/batch/status",{batchId:review.batchId})).value;
  expect(status.candidates[0].operation.animation.method).toBe("generated-image-local-animation");
  expect(calls).toHaveLength(1);expect(app.counters.providerRequests).toBe(0);
  const input=JSON.parse(JSON.parse(calls[0].body).prompt.split("\n").at(-1));
  expect(input.intent).toBe(intent);expect(input.expression.style).toBe("light-comic");
  expect(sourceCalls).toHaveLength(1);expect(app.memeCounters.imageRequests).toBe(0);
});
