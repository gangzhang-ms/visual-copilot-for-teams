import {expect,test,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {openCreate} from "../expression-ui";
import {offlineDraft} from "../../src/server/generation.test.support";
let app:Awaited<ReturnType<typeof Factory>>,origin:string,clock:number,calls:number[],rateLimited:boolean,hold:boolean,release:(()=>void)|undefined;
let providerFailure:{status:number;body:unknown}|undefined,badImage:"response"|"local-render"|undefined;
const realNow=Date.now,root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
test.beforeEach(async()=>{
  clock=realNow();Date.now=()=>clock;calls=[];rateLimited=false;hold=false;release=undefined;
  providerFailure=undefined;badImage=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));
  expect(localPaidLease.busy).toBe(false);localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const image=await sharp({create:{width:1024,height:1024,channels:3,background:"#6688aa"}}).png().toBuffer();
  app=await createLocalChatServer("OFFLINE-INSTANT-CREATE",{
    clientRoot:resolve(root,"client"),interaction:"direct-personal",catalogSource:"original-demo",
    generation:{...ongoingPersonalGenerationOptions(),transport:async()=>{
      calls.push(clock);
      if(hold)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,30_000);release=()=>{clearTimeout(timer);resolve();};});
      if(rateLimited)return new Response("",{status:429,headers:{"retry-after":"2"}});
      if(providerFailure)return new Response(JSON.stringify(providerFailure.body),{status:providerFailure.status,headers:{"content-type":"application/json"}});
      if(badImage)return new Response(JSON.stringify({data:badImage==="response"?[]:[{b64_json:Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")}]}),{headers:{"content-type":"application/json"}});
      return new Response(JSON.stringify({data:[{b64_json:image.toString("base64")}]}),{headers:{"Content-Type":"application/json"}});
    }},
    transport:async(_url,init)=>{
      const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content[0].text);
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        candidates:input.catalog.slice(0,3).map((c:{id:string})=>({id:c.id,reason:"Fictional encouragement",caution:"Uncertain"}))
      })}}]}));
    }
  });origin=await app.start(0);
});
test.afterEach(async()=>{release?.();try{await app.close();}finally{Date.now=realNow;}});
async function open(page:Page,language:"en"|"zh-CN"="en"){
  await page.clock.setFixedTime(clock);await page.setViewportSize({width:1440,height:900});await page.goto(origin+"/chat");
  await page.getByLabel("Language / 语言").selectOption(language);await openCreate(page,language);
  await page.getByLabel(language==="en"?"What would you like to express?":"你想表达什么？",{exact:true}).fill("An original fictional owl");
}
async function create(page:Page,language:"en"|"zh-CN"="en"){
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/review");
  await page.getByRole("button",{name:language==="en"?"Generate image":"生成图片",exact:true}).click();
  return (await (await response)).json();
}
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const session=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const payload=["generation/process","state"].includes(path)?body:{revision:session.revision,...body};
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:JSON.stringify(payload)});
    return {status:response.status,value:await response.json()};
  },{path,body});
}
test("two explicit image generations finish at the same fake time without a 61-second wait",async({page})=>{
  await open(page);
  for(let i=0;i<2;i++){
    const prepared=await create(page);expect(prepared.dispatchable).toBe(true);
    await expect(page.getByText("Output ready for your inspection",{exact:true})).toBeVisible();
    await expect(page.getByTestId("generation-readiness")).toContainText("Ready to create");
    await expect(page.getByTestId("generation-readiness")).not.toContainText("Please wait");
    const state=(await api(page,"state")).value;
    expect(state.generation).toMatchObject({ready:true,reason:"available",cooldownUntil:0});
    expect(app.resources()).toMatchObject({paidBusy:false,nativeBusy:false});
    const replay=await api(page,"generation/process",{operationId:prepared.operationId,digest:prepared.digest,consent:true});
    expect(replay.value.status).toBe("ready");expect(calls).toHaveLength(i+1);
  }
  expect(calls).toEqual([clock,clock]);expect(app.counters.providerRequests).toBe(0);
});
test("double clicks and cancellation keep the physical lease until the held provider finishes",async({page})=>{
  await open(page);hold=true;
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/review");
  await page.getByRole("button",{name:"Generate image",exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  const prepared=await (await response).json();
  await expect.poll(()=>calls.length).toBe(1);
  await expect(page.getByTestId("generation-readiness")).toContainText("Creation is in progress");
  await page.getByRole("button",{name:"Hide AI panel",exact:true}).click();
  await page.getByRole("button",{name:"Open AI panel",exact:true}).click();
  expect(calls).toHaveLength(1);
  await page.getByRole("button",{name:"Cancel generation",exact:true}).click();
  await page.getByRole("radio",{name:"Find an existing image",exact:true}).check();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await expect(page.getByTestId("generation-readiness")).toContainText("Creation is in progress");
  expect(app.resources()).toMatchObject({paidBusy:true,nativeBusy:true});
  const duplicate=await api(page,"generation/process",{operationId:prepared.operationId,digest:prepared.digest,consent:true});
  expect(duplicate.value.status).not.toBe("ready");expect(calls).toHaveLength(1);
  await expect(page.getByRole("button",{name:"Generate image",exact:true})).toBeDisabled();
  expect((await api(page,"generation/review",{draft:offlineDraft(),draftRevision:0})).value.code).toBe("processing-review-required");
  expect(app.resources().paidBusy).toBe(true);expect(calls).toHaveLength(1);
  hold=false;release?.();
  await expect.poll(()=>app.resources().paidBusy).toBe(false);
  await expect(page.getByTestId("generation-readiness")).toContainText("Ready to create");
  await expect(page.getByText("Output ready for your inspection",{exact:true})).toHaveCount(0);
  const fresh=await create(page);expect(fresh.dispatchable).toBe(true);
  await expect(page.getByText("Output ready for your inspection",{exact:true})).toBeVisible();
  expect(calls).toEqual([clock,clock]);
});
for(const language of ["en","zh-CN"] as const)test(`actual 429 backoff is visible in ${language}, expires, and requires explicit retry`,async({page,browser})=>{
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  await open(page,language);rateLimited=true;await create(page,language);
  await expect(page.getByTestId("generation-readiness")).toContainText(t("rate limiting","暂时限流"));
  await expect(page.getByTestId("generation-readiness")).not.toContainText(t("current request to finish","当前请求完成"));
  let state=(await api(page,"state")).value;
  expect(state.generation).toMatchObject({ready:false,reason:"generation-cooling-down",cooldownUntil:clock+2000});
  expect(app.resources().paidBusy).toBe(false);
  await expect(page.getByRole("button",{name:t("Generate image","生成图片"),exact:true})).toBeDisabled();
  const other=await browser.newContext(),otherPage=await other.newPage();await otherPage.goto(origin+"/chat");
  const blocked=(await api(otherPage,"generation/review",{draft:offlineDraft(),draftRevision:0})).value;expect(blocked.dispatchable).toBe(false);
  expect((await api(otherPage,"generation/process",{operationId:blocked.operationId,digest:blocked.digest,consent:true})).value.code).toBe("generation-cooling-down");
  await other.close();
  expect(calls).toHaveLength(1);
  clock+=1999;await page.clock.setFixedTime(clock);expect((await api(page,"state")).value.generation.ready).toBe(false);
  clock++;await page.clock.setFixedTime(clock);
  await expect(page.getByTestId("generation-readiness")).toContainText(t("Ready to create","可以开始创作"));
  expect(calls).toHaveLength(1);
  rateLimited=false;const ready=await create(page,language);expect(ready.dispatchable).toBe(true);
  await expect(page.getByText(t("Output ready for your inspection","输出等待你检查"),{exact:true})).toBeVisible();
  expect(calls[1]-calls[0]).toBe(2000);expect(calls).toHaveLength(2);
});
test("normal text ranking keeps its 6.1-second interval without imposing it on the next image",async({page})=>{
  await open(page);
  await page.getByRole("radio",{name:"Find an existing image",exact:true}).check();
  await page.getByRole("button",{name:"Review selected content",exact:true}).click();
  await page.getByRole("button",{name:"Recommend expressions",exact:true}).click();
  await expect(page.locator(".local-candidate")).toHaveCount(3);
  const state=(await api(page,"state")).value;
  expect(state.cooldownUntil).toBe(clock+6100);expect(state.generation).toMatchObject({ready:true,cooldownUntil:0});
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await expect(page.locator(".local-copilot")).not.toContainText("Please wait");
  expect((await create(page)).dispatchable).toBe(true);
  await expect(page.getByText("Output ready for your inspection",{exact:true})).toBeVisible();
  expect(calls).toEqual([clock]);expect(app.counters.providerRequests).toBe(1);
  expect((await api(page,"state")).value.cooldownUntil).toBe(clock+6100);
});
for(const [language,status,providerCode,code] of [
  ["en",400,"ResponsibleAIPolicyViolation","generation-refused"],
  ["zh-CN",400,"ResponsibleAIPolicyViolation","generation-refused"],
  ["en",400,"invalid_request_error","generation-request-rejected"],
  ["en",413,"RequestTooLarge","generation-request-too-large"],
  ["en",422,"InvalidInput","generation-request-rejected"]
] as const)test(`request-local ${status} ${providerCode} in ${language} keeps draft, releases leases and permits only explicit retry`,async({page})=>{
  await open(page,language);
  providerFailure={status,body:{error:{code:"BadRequest",message:"PRIVATE PROVIDER TEXT",innererror:{code:providerCode}}}};
  const processed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/process");
  await create(page,language);
  const result=await (await processed).json();
  expect(result).toMatchObject({status:"failed",code,failure:{stage:"provider",httpStatus:status}});
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  await expect(page.getByTestId("generation-readiness")).toContainText(language==="en"?"Ready to create":"可以开始创作");
  const generate=page.getByRole("button",{name:language==="en"?"Generate image":"生成图片",exact:true});
  await expect(generate).toBeEnabled();
  await expect(page.getByLabel(language==="en"?"What would you like to express?":"你想表达什么？",{exact:true})).toHaveValue("An original fictional owl");
  expect((await api(page,"state")).value.generation).toMatchObject({ready:true,reason:"available"});
  expect(app.resources()).toMatchObject({paidBusy:false,nativeBusy:false});expect(calls).toHaveLength(1);
  expect(await page.locator("body").innerText()).not.toMatch(/PRIVATE|ResponsibleAIPolicyViolation|generation-request-rejected/);
  providerFailure=undefined;await create(page,language);
  await expect(page.getByText(language==="en"?"Output ready for your inspection":"输出等待你检查",{exact:true})).toBeVisible();
  expect(calls).toEqual([clock,clock]);
});
for(const [status,providerCode,code] of [[401,"Unauthorized","generation-access-denied"],[400,"OperationNotSupported","generation-capability-unavailable"]] as const)
test(`true ${providerCode} blocks all rooms for that configured image service and updates health`,async({page,browser})=>{
  await open(page);providerFailure={status,body:{error:{code:providerCode}}};
  const processed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/process");
  await create(page);expect((await (await processed).json()).code).toBe(code);
  await expect(page.getByRole("button",{name:"Generate image",exact:true})).toBeDisabled();
  expect((await api(page,"state")).value.generation).toMatchObject({ready:false,reason:code});
  expect(await (await page.request.get(origin+"/healthz")).json()).toMatchObject({imageGeneration:"disabled",imageGenerationScope:"configuration-only",imageGenerationProbe:"not-performed"});
  const other=await browser.newContext(),p=await other.newPage();await p.goto(origin+"/chat");
  expect((await api(p,"state")).value.generation).toMatchObject({ready:false,reason:code});
  await other.close();expect(calls).toHaveLength(1);expect(app.resources()).toMatchObject({paidBusy:false,nativeBusy:false});
});
for(const stage of ["response","local-render"] as const)test(`invalid ${stage} remains fail-closed in its own room with distinct stage diagnostics`,async({page,browser})=>{
  await open(page);badImage=stage;
  const processed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/process");
  await create(page);
  const code=stage==="response"?"generation-invalid-response":"generation-media-rejected";
  expect(await (await processed).json()).toMatchObject({status:"failed",code,failure:{stage,httpStatus:200}});
  await expect(page.getByRole("button",{name:"Generate image",exact:true})).toBeDisabled();
  expect((await api(page,"state")).value.generation).toMatchObject({ready:false,reason:code});
  expect(app.resources()).toMatchObject({paidBusy:false,nativeBusy:false});
  const other=await browser.newContext(),p=await other.newPage();await p.goto(origin+"/chat");
  expect((await api(p,"state")).value.generation.ready).toBe(true);
  await other.close();expect(calls).toHaveLength(1);
});
