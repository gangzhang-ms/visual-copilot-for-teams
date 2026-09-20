import { expect,test,type Page,type APIRequestContext } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ImageAllowance as Allowance } from "../../src/server/image-allowance";
import type { GenerationBudget } from "../../src/server/local-generation-config";
import type { createLocalChatServer as Factory } from "../../src/server/local-chat-server";
import type { issueGenerationAdmission as Issue } from "../../src/server/local-generation-config";
import { offlineApproval,offlineDraft,offlineProfile } from "../../src/server/generation.test.support";
import {openCreate} from "../expression-ui";
import type { LocalGenerationReview,LocalGenerationStatus,LocalState } from "../../src/shared/local-chat";
let app:Awaited<ReturnType<typeof Factory>>|undefined,origin="",clock=0,index=0;
let bodySent="",hold=false,flat=false,rateLimited=false,releaseBody:(()=>void)|undefined,buffer:Buffer;
const realNow=Date.now,realFetch=globalThis.fetch;
const buildRoot=process.env.VISUAL_BUILD_ROOT??"dist";
const built=(file:string)=>pathToFileURL(resolve(buildRoot,"server",file)).href;
test.beforeAll(async()=>{
  buffer=await sharp(Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" fill="white"/><rect x="100" y="150" width="300" height="280" fill="#ef7d71"/><circle cx="710" cy="650" r="190" fill="#395ebb"/></svg>')).png().toBuffer();
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    if(new URL(url).hostname!=="127.0.0.1")throw new Error("Unexpected nonloopback egress in offline test");
    return realFetch(input,init);
  };
});
test.beforeEach(()=>{clock=Math.max(realNow()+(++index)*61_001,clock+61_001);Date.now=()=>clock;bodySent="";hold=false;flat=false;rateLimited=false;releaseBody=undefined;});
test.afterEach(async()=>{await app?.close();app=undefined;Date.now=realNow;});
test.afterAll(()=>{globalThis.fetch=realFetch;});
async function start(ready=false,calls=1,validationOnly=false,budget?:GenerationBudget,direct=false) {
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {issueGenerationAdmission}:{issueGenerationAdmission:typeof Issue}=await import(built("local-generation-config.js"));
  const {buildCreativeBrief}=await import(built("local-generation.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const ongoing=direct?ongoingPersonalGenerationOptions():undefined;
  const profile=ongoing?.profile??offlineProfile(),admission=ongoing?.admission??(ready?issueGenerationAdmission(profile,{...offlineApproval(),approvedCalls:calls,
    ...(validationOnly?{mode:"validation-only" as const,acceptedCanary:undefined,syntheticBodyDigest:createHash("sha256").update(buildCreativeBrief(offlineDraft(),[]).body).digest("base64url")}: {}),
    ...(budget?{expiresAt:budget.expiresAt,acceptedRisks:[],personalAuthorization:{id:budget.authorizationId,approvedAt:budget.approvedAt,scope:"personal-local-images" as const,technicalCanary:budget.status().canaryHash}}:{})},budget):undefined);
  app=await createLocalChatServer("OFFLINE-FAKE-CREDENTIAL",{
    clientRoot:resolve(buildRoot,"client"),catalogSource:"original-demo",cooldownMs:0,...(direct?{interaction:"direct-personal" as const}:{}),
    generation:ready?{profile,admission,transport:async(_url,init)=>{
      bodySent=String(init?.body);const bytes=flat?await sharp({create:{width:1024,height:1024,channels:3,background:"white"}}).png().toBuffer():buffer;
      if(rateLimited)return new Response("",{status:429,headers:{"retry-after":"60"}});
      const serialized=JSON.stringify({data:[{b64_json:bytes.toString("base64")}]});
      if(!hold)return new Response(serialized,{headers:{"Content-Type":"application/json"}});
      return new Response(new ReadableStream<Uint8Array>({start(controller){
        releaseBody=()=>{try{controller.enqueue(new TextEncoder().encode(serialized));controller.close();}catch{/* Cancelled fixture stream. */}};
      }}),{headers:{"Content-Type":"application/json"}});
    }}:undefined,
    transport:async(_url,init)=>{
      const request=JSON.parse(String(init?.body)),input=JSON.parse(request.messages[1].content[0].text);
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(input.task==="rank"?{
        candidates:input.catalog.slice(0,3).map((a:{id:string})=>({id:a.id,reason:"Private fixture reason",caution:"Uncertain"}))
      }:{
        background:{source:null,context:null,frames:[]},observations:[{text:"OFFLINE: geometric fixture",frames:input.frames.map((f:{id:string})=>f.id)}],commonUsage:["Uncertain"],
        contextualInterpretations:[{text:"A possible fictional greeting",context:input.context.map((c:{label:string})=>c.label)}],
        uncertainties:["OFFLINE fixture only"],safeResponseGuidance:["Ask for clarification"]
      })}}]}));
    }
  });
  origin=await app.start(0);
}
for(const variant of ["image","gif"] as const)test(`ongoing local ${variant} UI runs Create, Express and one-click Explain without permission checkboxes or material attestation`,async({page})=>{
      await start(true,1,false,undefined,true);await open(page);await prepare(page);
      await expect(page.getByRole("checkbox",{name:/explicitly consent/})).toHaveCount(0);
      await expect(page.getByTestId("generation-readiness")).not.toContainText("remaining");
      const button=page.getByRole("button",{name:"Generate image",exact:true});
      await expect(button).toBeEnabled();expect(app!.generationCounters.providerRequests).toBe(0);
      await button.click();await expect(page.getByText("Output ready for your inspection",{exact:true})).toBeVisible();
      if(variant==="gif"){
        await page.getByRole("button",{name:"Make an animated GIF",exact:true}).click();
        await expect(page.getByRole("button",{name:"Use local GIF",exact:true})).toHaveAttribute("aria-pressed","true");
      }
      await expect(page.getByRole("checkbox",{name:/I inspected/})).toHaveCount(0);
      await page.getByRole("button",{name:"Preview generated insertion",exact:true}).click();
      await page.getByRole("button",{name:"Insert generated visual locally",exact:true}).click();
      await expect(page.getByTestId("chat-message")).toHaveCount(1);
      if(variant==="gif")await expect(page.getByTestId("chat-message").getByRole("button",{name:"Play animation",exact:true})).toBeVisible();
      expect(await page.getByTestId("chat-message").innerText()).not.toMatch(/Model \/ version|downsampled|Pending human/iu);
      await page.getByTestId("chat-message").getByRole("button",{name:"Message actions",exact:true}).click();
      await page.getByRole("menuitem",{name:"Media information",exact:true}).click();
      await expect(page.getByRole("dialog",{name:"Media information",exact:true})).toContainText("Pending human and rights review");
      await page.keyboard.press("Escape");
      clock+=61_001;await page.clock.setFixedTime(clock);
      const row=page.getByTestId("chat-message"),inline=row.locator(".inline-emoji-explanation");
      await row.locator(".visual-enlargement > summary").click();
      expect(app!.counters.providerRequests).toBe(0);
      if(variant==="gif")await expect(row.locator(".emoji-enlargement-panel .message-visual-image")).toHaveAttribute("src",/\/animation$/);
      await inline.getByRole("button",{name:"Explain with AI",exact:true}).click();
      await expect(inline.locator(".inline-emoji-result")).toBeVisible();
      await inline.getByRole("button",{name:"Details",exact:true}).click();
      await expect(inline.locator(".inline-explanation-details")).toContainText("OFFLINE: geometric fixture");
      await expect(inline.locator(".inline-explanation-details")).toContainText("Ask for clarification");
      await expect(inline.locator(".inline-explanation-details")).toContainText("cannot be identified confidently");
      expect(app!.counters.providerRequests).toBe(1);
      await expect(page.getByRole("region",{name:"Transmission preview"})).toHaveCount(0);
      await page.getByRole("button",{name:"Express",exact:true}).click();
      await page.getByLabel("What would you like to express?",{exact:true}).fill("Support a fictional puzzle team");
      await page.getByRole("button",{name:"Review selected content",exact:true}).click();
      await expect(page.getByRole("checkbox",{name:/I own or may use/})).toHaveCount(0);
      await page.getByRole("button",{name:"Recommend expressions",exact:true}).click();
      await expect(page.locator(".local-candidate")).toHaveCount(3);
      await page.getByRole("button",{name:"Preview insertion",exact:true}).first().click();
      await page.getByRole("button",{name:"Insert into local chat",exact:true}).click();
      await expect(page.getByTestId("chat-message")).toHaveCount(2);
      await page.getByTestId("chat-message").last().getByRole("button",{name:"Explain",exact:true}).click();
      await page.locator(".explanation-details > summary").click();
      await expect(page.locator(".explanation-panel .explanation-details")).toContainText("OFFLINE: geometric fixture");
      expect(app!.counters).toEqual({providerRequests:3,graphRequests:0});expect(app!.generationCounters.providerRequests).toBe(1);
      await page.getByRole("button",{name:/Review asset library/}).click();
      await expect(page.getByRole("region",{name:"Local asset review"}).getByRole("checkbox")).toHaveCount(0);
      await page.setViewportSize({width:320,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    });
    test("ongoing mode permits more than three independent image operations after old expiry while replay never spends twice",async({request})=>{
      try{
      clock=Date.parse("2030-01-01");await start(true,1,false,undefined,true);
      let room=await connect(request);
      for(let i=0;i<5;i++){
        clock+=61_001;
        const review=await (await post(request,room.csrf,"generation/review",{revision:room.revision,draftRevision:i,draft:offlineDraft()})).json() as LocalGenerationReview;
        const body={operationId:review.operationId,digest:review.digest,consent:true};
        const result=await (await post(request,room.csrf,"generation/process",body)).json();
        expect(result.status).toBe("ready");
        expect((await (await post(request,room.csrf,"generation/process",body)).json()).status).toBe("ready");
        expect(app!.generationCounters.providerRequests).toBe(i+1);
        const state=await (await post(request,room.csrf,"state",{})).json();room={...state,csrf:room.csrf};
        expect(room.generation?.remainingCalls).toBeNull();expect(room.generation?.expiresAt).toBeUndefined();
      }
      expect(app!.generationCounters.providerRequests).toBe(5);
      }finally{
        const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;clock=realNow();
      }
    });
    test("ongoing mode exposes Azure 429 and cancellation without automatic retry or restored output",async({request})=>{
      await start(true,1,false,undefined,true);let room=await connect(request);
      rateLimited=true;
      const review=await (await post(request,room.csrf,"generation/review",{revision:room.revision,draftRevision:1,draft:offlineDraft()})).json();
      const body={operationId:review.operationId,digest:review.digest,consent:true};
      expect((await request.post(origin+"/local/generation/process",{headers:{Origin:"https://foreign.invalid","X-Local-CSRF":room.csrf},data:body})).status()).toBe(400);
      expect((await request.post(origin+"/local/generation/process",{headers:{Origin:origin},data:body})).status()).toBe(400);
      expect((await post(request,room.csrf,"generation/process",{...body,digest:"tampered"})).status()).toBe(400);
      expect((await post(request,room.csrf,"generation/process",{...body,consent:false})).status()).toBe(400);
      expect(app!.generationCounters.providerRequests).toBe(0);
      const failed=await (await post(request,room.csrf,"generation/process",body)).json();
      expect(failed).toMatchObject({status:"failed",code:"generation-rate-limited"});
      await post(request,room.csrf,"generation/process",body);expect(app!.generationCounters.providerRequests).toBe(1);
      const state=await (await post(request,room.csrf,"state",{})).json();room={...state,csrf:room.csrf};
      expect(room.generation?.reason).toBe("generation-cooling-down");
      clock+=61_001;rateLimited=false;hold=true;
      const next=await (await post(request,room.csrf,"generation/review",{revision:room.revision,draftRevision:2,draft:offlineDraft()})).json();
      const pending=post(request,room.csrf,"generation/process",{operationId:next.operationId,digest:next.digest,consent:true});
      await expect.poll(()=>!!releaseBody).toBe(true);await post(request,room.csrf,"cancel",{});releaseBody!();
      const cancelled=await (await pending).json();expect(cancelled.status).not.toBe("ready");expect(cancelled.image).toBeUndefined();
      expect(app!.generationCounters.providerRequests).toBe(2);
    });
async function open(page:Page,language="en"){
  await page.clock.setFixedTime(clock);await page.goto(origin+"/chat");
  await expect(page.getByLabel("Language / 语言")).toBeEnabled();
  await page.getByLabel("Language / 语言").selectOption(language);
  await openCreate(page,language);
  await expect(page.getByRole("region",{name:language==="en"?"Create a new visual":"创作新视觉内容"})).toBeVisible();
}
async function prepare(page:Page,gif=false){
  await page.getByLabel(/^(Creative intent|What would you like to express\?)$/).fill("A self-authored greeting for a fictional puzzle");
  await page.getByLabel("Creative description",{exact:true}).fill("One red square and one blue circle");
  await page.getByLabel("Requested output",{exact:true}).selectOption(gif?"gif":"image");
  await page.getByText("Culture & style (optional)",{exact:true}).click();
  await page.getByLabel("Culture / language context",{exact:true}).fill("Voluntarily unspecified culture");
  if(await page.getByRole("button",{name:"Prepare exact creative brief",exact:true}).count()){
    await page.getByRole("button",{name:"Prepare exact creative brief",exact:true}).click();
    await expect(page.getByRole("region",{name:"Exact creative request",exact:true})).toBeVisible();
  }
}
async function generate(page:Page){
  const checkbox=page.getByRole("checkbox",{name:/explicitly consent to this exact paid/});await checkbox.focus();await page.keyboard.press("Space");
  const button=page.getByRole("button",{name:"Generate once",exact:true});await button.focus();await page.keyboard.press("Enter");
  await expect(page.getByText("Output ready for your inspection",{exact:true})).toBeVisible();
}
async function connect(request:APIRequestContext){
  const r=await request.post(origin+"/local/session",{headers:{Origin:origin},data:{}});
  expect(r.status()).toBe(200);return await r.json() as LocalState&{csrf:string};
}
async function post(request:APIRequestContext,csrf:string,path:string,body:object){
  return request.post(origin+"/local/"+path,{headers:{Origin:origin,"X-Local-CSRF":csrf},data:body});
}
test("personal browser consent uses durable shared allowance across server restart without storing request content",async({page})=>{
  const {ImageAllowance}:{ImageAllowance:typeof Allowance}=await import(built("personal-image.js"));
  const directory=mkdtempSync(resolve(tmpdir(),"personal-image-e2e-"));
  const authorization={authorizationId:"OFFLINE-PERSONAL-TEST",approvedAt:clock-1000,expiresAt:clock+600_000,owner:"OFFLINE-TEST-OWNER"};
  const ledger=new ImageAllowance(directory,authorization);
  try{
    ledger.initialize();ledger.consume("canary","OFFLINE-CANARY");ledger.finish("OFFLINE-CANARY","ready");
    ledger.verifyCanary(createHash("sha256").update("OFFLINE proof; not a live canary").digest("base64url"));
    clock+=61_001;await start(true,3,false,ledger.budget("ordinary"));await open(page);await prepare(page);
    await expect(page.getByTestId("generation-readiness")).toContainText("three ordinary attempts total");
    await expect(page.getByRole("button",{name:"Generate once",exact:true})).toBeDisabled();
    expect(ledger.status("ordinary").remaining).toBe(3);expect(app!.generationCounters.providerRequests).toBe(0);
    await generate(page);expect(ledger.status("ordinary").remaining).toBe(2);
    const journal=readFileSync(resolve(directory,"events.jsonl"),"utf8");
    expect(journal).not.toContain(bodySent);expect(journal).not.toContain("OFFLINE-FAKE-CREDENTIAL");expect(journal).not.toContain("fictional puzzle");
    await app!.close();app=undefined;clock+=61_001;
    const restart=new ImageAllowance(directory,authorization);restart.initialize();
    await start(true,3,false,restart.budget("ordinary"));await open(page);await prepare(page);
    await expect(page.getByTestId("generation-readiness")).toContainText("Approved image calls remaining: 2");
    expect(app!.generationCounters.providerRequests).toBe(0);
    expect(restart.status("ordinary").remaining).toBe(2);
  }finally{await app?.close();app=undefined;rmSync(directory,{recursive:true,force:true});}
});
test("shipped disabled UI prepares exact bilingual briefs without authority or any image call",async({page,request})=>{
  await start();await open(page);await prepare(page);
  const region=page.getByRole("region",{name:"Exact creative request"});
  await expect(region).toContainText("One red square and one blue circle");
  await expect(region).toContainText("No provisioned image destination");
  await expect(page.getByRole("button",{name:"Generate — not provisioned / authorized",exact:true})).toBeDisabled();
  expect(app!.generationCounters.providerRequests).toBe(0);
  const s=await connect(request),review=await post(request,s.csrf,"generation/review",{revision:s.revision,draftRevision:0,draft:offlineDraft()});
  const value=await review.json() as LocalGenerationReview;
  expect(value.dispatchable).toBe(false);
  expect((await post(request,s.csrf,"generation/process",{operationId:value.operationId,digest:value.digest,consent:true})).status()).toBe(400);
  expect((await post(request,s.csrf,"generation/process",{operationId:value.operationId,digest:value.digest,consent:true,mode:"ready"})).status()).toBe(400);
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await expect(page.getByTestId("generation-readiness")).toContainText("尚未部署或授权");
  await page.setViewportSize({width:320,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(app!.generationCounters.providerRequests).toBe(0);
});
test("offline real-worker image to local GIF, exact manual bubble and generated Explain without catalog rights",async({page})=>{
  await start(true);await open(page);await prepare(page);
  const exact=await page.getByRole("region",{name:"Exact creative request"}).locator("pre").innerText();
  expect(app!.generationCounters.providerRequests).toBe(0);await generate(page);expect(bodySent).toBe(exact);
  await page.getByRole("button",{name:"Animate locally — zero image calls",exact:true}).click();
  await expect(page.getByRole("button",{name:"Use local GIF",exact:true})).toBeVisible();expect(app!.generationCounters.providerRequests).toBe(1);
  const operation=page.getByRole("region",{name:"Generation operation"}),image=operation.locator(".generated-artwork img");
  await expect(image).toHaveAttribute("src",/\/poster$/);
  await page.emulateMedia({reducedMotion:"reduce"});await expect(image).toHaveAttribute("src",/\/poster$/);
  await operation.getByRole("button",{name:"Play animation",exact:true}).click();await expect(image).toHaveAttribute("src",/\/animation$/);
  await operation.getByRole("button",{name:"Stop animation",exact:true}).click();await expect(image).toHaveAttribute("src",/\/poster$/);
  const caption="Own local caption "+"长".repeat(482),alt="Description "+"详".repeat(288);
  await page.getByLabel("Local output caption",{exact:true}).fill(caption);
  await page.getByLabel("Image description / alt text",{exact:true}).fill(alt);
  await page.getByRole("checkbox",{name:"I inspected this output, its meaning and notices for permitted local test use."}).check();
  await page.getByRole("button",{name:"Preview generated insertion",exact:true}).click();
  const preview=page.getByRole("region",{name:"Generated insertion preview"});await expect(preview).toContainText(caption);
  await expect(preview).toContainText("Pending human and rights review");
  await page.getByLabel("Local output caption",{exact:true}).fill("Edited "+caption.slice(7));await expect(preview).toHaveCount(0);
  await page.getByRole("button",{name:"Preview generated insertion",exact:true}).click();
  await page.setViewportSize({width:320,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole("button",{name:"Insert generated visual locally",exact:true}).focus();await page.keyboard.press("Enter");
  const bubble=page.getByTestId("chat-message");await expect(bubble).toHaveCount(1);await expect(bubble).toContainText(alt);
  await expect(bubble).not.toContainText("Voluntarily unspecified culture");await expect(bubble).not.toContainText("self-authored greeting");
  await expect(bubble.locator(".generated-artwork img")).toHaveAttribute("src",/\/poster$/);
  await bubble.getByRole("button",{name:"Explain",exact:true}).click();
  await page.getByRole("button",{name:"Preview model request",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Too much context");
  expect(app!.counters.providerRequests).toBe(0);
  await page.getByLabel("Context 1",{exact:true}).fill("Owned fictional puzzle greeting");
  await page.getByRole("button",{name:"Preview model request",exact:true}).click();
  await expect(page.getByAltText(/^Transmitted frame/)).toHaveCount(2);
  expect(await page.getByAltText(/^Transmitted frame/).first().evaluate((e:HTMLImageElement)=>e.naturalWidth)).toBe(128);
  expect(app!.generationCounters.providerRequests).toBe(1);expect(app!.counters.providerRequests).toBe(0);
  expect(app!.resources().cacheGroups).toBe(1);
  await page.getByRole("button",{name:"Back to edit",exact:true}).click();
  await expect.poll(()=>app!.resources().cacheGroups).toBe(0);
  const url=await bubble.locator(".generated-artwork img").getAttribute("src");
  await page.getByRole("button",{name:"Hide AI panel",exact:true}).click();
  await bubble.getByRole("button",{name:"Remove",exact:true}).click();await expect(bubble).toHaveCount(0);
  expect((await page.context().request.get(origin+url!)).status()).toBe(400);
});
test("GIF-first result and honest flat-image fallback both use actual output workers",async({page})=>{
  flat=true;await start(true);await open(page);await prepare(page,true);await generate(page);
  await expect(page.getByText("GIF creation failed; the valid PNG is retained. No GIF success is claimed.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Use local GIF",exact:true})).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Generation operation"}).locator(".generated-artwork img")).toBeVisible();
  await page.getByRole("checkbox",{name:"I inspected this output, its meaning and notices for permitted local test use."}).check();
  await page.getByRole("button",{name:"Preview generated insertion",exact:true}).click();
  await page.getByRole("button",{name:"Insert generated visual locally",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
  await expect(page.getByTestId("chat-message")).toContainText("AI-generated still image");
  expect(app!.generationCounters.providerRequests).toBe(1);
});
test("create GIF first then mode changes preserve inserted ownership but discard uninserted output",async({page})=>{
  await start(true);await open(page);await prepare(page,true);await generate(page);
  await expect(page.getByRole("button",{name:"Use local GIF",exact:true})).toBeVisible();
  const src=await page.getByRole("region",{name:"Generation operation"}).locator(".generated-artwork img").getAttribute("src");
  await page.getByRole("button",{name:"Express",exact:true}).click();
  await expect(page.getByRole("region",{name:"Generation operation"})).toHaveCount(0);
  await expect.poll(async()=>(await page.context().request.get(origin+src!)).status()).toBe(400);
  expect(app!.generationCounters.providerRequests).toBe(1);
});
test("held response body prevents another paid call, replay is status-only, and cancel never revives output",async({request,browser})=>{
  hold=true;await start(true,2);const s=await connect(request);
  const r=await post(request,s.csrf,"generation/review",{revision:s.revision,draftRevision:0,draft:offlineDraft()}),review=await r.json() as LocalGenerationReview;
  const pending=post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true});
  await expect.poll(()=>app!.generationCounters.providerRequests).toBe(1);
  const replay=await post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true});
  expect((await replay.json()).status).toBe("dispatching");
  expect((await post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:"wrong",consent:true})).status()).toBe(400);
  const other=await browser.newContext(),second=await connect(other.request);
  const message=await post(other.request,second.csrf,"message",{revision:second.revision,speaker:"Fiction",text:"A wholly fictional second room"}),room=await message.json() as LocalState;
  const analysisReview=await post(other.request,second.csrf,"review",{revision:room.revision,command:"explainVisual",selectedId:room.messages[0].id,
    input:{intent:"Explain the fictional greeting",context:[{label:room.messages[0].id,text:"Fictional greeting",included:true,timestamp:""}],
      preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}}});
  const reviewedAnalysis=await analysisReview.json();
  expect((await post(other.request,second.csrf,"process",{revision:reviewedAnalysis.revision,digest:reviewedAnalysis.processing.digest,consent:true})).status()).toBe(400);
  expect(app!.counters.providerRequests).toBe(0);
  const cancelled=await post(request,s.csrf,"cancel",{});expect(cancelled.status()).toBe(200);
  releaseBody?.();await pending;
  const status=await post(request,s.csrf,"generation/status",{operationId:review.operationId});
  const value=await status.json() as LocalGenerationStatus;expect(value.image).toBeUndefined();expect(value.status).toBe("unknown-after-dispatch");
  const repeat=await post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true});
  expect(repeat.status()).toBe(200);expect(app!.generationCounters.providerRequests).toBe(1);
  const state=await post(request,s.csrf,"state",{});expect((await state.json()).generation.remainingCalls).toBe(1);
  hold=false;
  const fresh=await post(other.request,second.csrf,"generation/review",{revision:reviewedAnalysis.revision,draftRevision:1,draft:offlineDraft()}),next=await fresh.json() as LocalGenerationReview;
  clock+=60_999;
  expect((await post(other.request,second.csrf,"generation/process",{operationId:next.operationId,digest:next.digest,consent:true})).status()).toBe(400);
  expect(app!.generationCounters.providerRequests).toBe(1);
  clock+=1;
  expect((await (await post(other.request,second.csrf,"generation/process",{operationId:next.operationId,digest:next.digest,consent:true})).json()).status).toBe("ready");
  expect(app!.generationCounters.providerRequests).toBe(2);await other.close();
});
test("editing and reset during a paid fixture clear epochs and cannot show delayed success",async({page})=>{
  hold=true;await start(true);await open(page);await prepare(page);
  await page.getByRole("checkbox",{name:/explicitly consent to this exact paid/}).check();await page.getByRole("button",{name:"Generate once",exact:true}).click();
  await expect.poll(()=>app!.generationCounters.providerRequests).toBe(1);
  await page.getByLabel("Creative intent",{exact:true}).fill("A changed draft");
  await expect(page.getByRole("region",{name:"Exact creative request"})).toHaveCount(0);
  releaseBody?.();
  await expect(page.getByRole("button",{name:"Prepare exact creative brief",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Clear room & revoke consent",exact:true}).click();
  await expect(page.getByRole("region",{name:"Generation operation"})).toHaveCount(0);await expect(page.getByTestId("chat-message")).toHaveCount(0);
  expect(app!.generationCounters.providerRequests).toBe(1);
});
test("generated ownership and strict preview snapshots resist foreign session, tampering and duplicate insertion",async({request,browser})=>{
  await start(true);const s=await connect(request),r=await post(request,s.csrf,"generation/review",{revision:s.revision,draftRevision:0,draft:offlineDraft()}),review=await r.json() as LocalGenerationReview;
  const response=await post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true}),result=await response.json() as LocalGenerationStatus;
  expect(result.status).toBe("ready");
  const context=await browser.newContext(),other=await connect(context.request);
  expect((await context.request.get(origin+result.image!.posterUrl)).status()).toBe(400);
  expect((await post(context.request,other.csrf,"generation/status",{operationId:review.operationId})).status()).toBe(400);
  const image=await request.get(origin+result.image!.posterUrl);expect(image.headers()["cache-control"]).toBe("no-store");expect(image.headers()["content-type"]).toBe("image/png");
  const p=await post(request,s.csrf,"generation/preview",{revision:review.revision,assetId:result.image!.assetId,variant:"image",caption:"Exact local caption",alt:"Self-authored test shape",speaker:"Test"});
  const preview=await p.json();
  expect((await post(request,s.csrf,"generation/insert",{revision:review.revision,handle:preview.handle,mediaUrl:"https://untrusted.example"})).status()).toBe(400);
  expect((await post(request,s.csrf,"generation/insert",{revision:review.revision,handle:preview.handle})).status()).toBe(200);
  expect((await post(request,s.csrf,"generation/insert",{revision:review.revision,handle:preview.handle})).status()).toBe(400);
  const state=await post(request,s.csrf,"state",{}),room=await state.json() as LocalState;
  expect(room.messages).toHaveLength(1);expect(JSON.stringify(room.messages)).not.toContain(offlineDraft().intent);
  const again=await post(request,s.csrf,"generation/preview",{revision:room.revision,assetId:result.image!.assetId,variant:"image",caption:"Second reference",alt:"Same owned pixels",speaker:"Other"});
  const secondPreview=await again.json();
  const duplicated=await post(request,s.csrf,"generation/insert",{revision:room.revision,handle:secondPreview.handle}),two=await duplicated.json() as LocalState;
  expect(two.messages).toHaveLength(2);
  const removed=await post(request,s.csrf,"remove",{revision:two.revision,id:two.messages[0].id});expect(removed.status()).toBe(200);
  expect((await request.get(origin+result.image!.posterUrl)).status()).toBe(200);
  expect((await post(request,s.csrf,"cancel",{})).status()).toBe(200);
  expect((await request.get(origin+result.image!.posterUrl)).status()).toBe(200);
  await post(request,s.csrf,"reset",{});expect((await request.get(origin+result.image!.posterUrl)).status()).toBe(400);
  expect(app!.generationCounters.providerRequests).toBe(1);await context.close();
});
test("strict local Origin, Host, CSRF, paths, validation-only and unknown fields cannot spend",async({request})=>{
  await start();
  expect((await request.post(origin+"/local/session",{headers:{Origin:"https://foreign.example"},data:{}})).status()).toBe(400);
  expect((await request.get(origin+"/healthz",{headers:{Host:"foreign.example"}})).status()).toBe(400);
  const s=await connect(request);
  for(const path of ["/local/generated/guessed/image","/local/generated/../model-key.dpapi","/.local/visual-context/model-key.dpapi","/local/generated/abc/image?token=abc"])
    expect((await request.get(origin+path)).status()).toBe(400);
  expect((await request.post(origin+"/local/generation/review",{headers:{Origin:origin},data:{revision:s.revision,draft:offlineDraft()}})).status()).toBe(400);
  const draft={...offlineDraft(),endpoint:"https://untrusted.example"};
  expect((await post(request,s.csrf,"generation/review",{revision:s.revision,draftRevision:0,draft})).status()).toBe(400);
  expect(app!.generationCounters.providerRequests).toBe(0);
});
test("a validation-only server grant never enables ordinary browser process",async({request})=>{
  await start(true,1,true);const s=await connect(request);
  expect(s.generation).toMatchObject({mode:"validation-only",ready:false,remainingCalls:1});
  const result=await post(request,s.csrf,"generation/review",{revision:s.revision,draftRevision:0,draft:offlineDraft()}),review=await result.json() as LocalGenerationReview;
  expect(review.dispatchable).toBe(false);
  const denied=await post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true});
  expect(denied.status()).toBe(400);expect((await denied.json()).code).toBe("validation-only-not-browser-ready");
  expect(app!.generationCounters.providerRequests).toBe(0);
});
test("three retained assets block new spend, reset releases bytes but never refills the grant",async({request})=>{
  await start(true,4);const s=await connect(request);let revision=s.revision;
  for(let i=0;i<3;i++){
    clock+=61_000;
    const r=await post(request,s.csrf,"generation/review",{revision,draftRevision:i,draft:offlineDraft()}),review=await r.json() as LocalGenerationReview;
    const p=await post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true}),result=await p.json() as LocalGenerationStatus;
    expect(result.status).toBe("ready");
    const preview=await post(request,s.csrf,"generation/preview",{revision:review.revision,assetId:result.image!.assetId,variant:"image",caption:"Owned test output",alt:"Original fixture",speaker:"Tester"});
    const handle=(await preview.json()).handle;
    const inserted=await post(request,s.csrf,"generation/insert",{revision:review.revision,handle});revision=(await inserted.json()).revision;
  }
  const r=await post(request,s.csrf,"generation/review",{revision,draftRevision:4,draft:offlineDraft()}),review=await r.json() as LocalGenerationReview;
  const denied=await post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true});
  expect((await denied.json()).code).toBe("generation-memory-limit");expect(app!.generationCounters.providerRequests).toBe(3);
  expect(app!.resources().generatedBytes).toBeGreaterThan(0);
  const reset=await post(request,s.csrf,"reset",{}),state=await reset.json() as LocalState;
  expect(state.generation!.remainingCalls).toBe(1);expect(app!.resources().generatedBytes).toBe(0);
  expect((await post(request,s.csrf,"generation/status",{operationId:review.operationId})).status()).toBe(400);
});
test("shared upload and normalized-cache quota denies image dispatch before consumption",async({request})=>{
  await start(true);const s=await connect(request);let revision=s.revision,seed=12345;
  const raw=Buffer.alloc(512*512*4);
  for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=i%4===3?255:seed>>>24;}
  const png=await sharp(raw,{raw:{width:512,height:512,channels:4}}).png().toBuffer();expect(png.length).toBeLessThan(1024*1024);
  let uploaded=0;
  for(let i=0;i<8;i++){
    const result=await post(request,s.csrf,"message",{revision,speaker:"Fixture",text:"Owned noise test",attachment:{mime:"image/png",base64:png.toString("base64"),category:"image"}});
    if(result.status()!==200){expect((await result.json()).code).toBe("request-byte-budget-exceeded");break;}
    const state=await result.json() as LocalState;revision=state.revision;uploaded++;
  }
  expect(uploaded).toBeGreaterThan(2);
  const current=await post(request,s.csrf,"state",{});revision=(await current.json()).revision;
  const r=await post(request,s.csrf,"generation/review",{revision,draftRevision:0,draft:offlineDraft()}),review=await r.json() as LocalGenerationReview;
  const denied=await post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true});
  expect((await denied.json()).code).toBe("generation-memory-limit");expect(app!.generationCounters.providerRequests).toBe(0);
  const state=await post(request,s.csrf,"state",{});expect((await state.json()).generation.remainingCalls).toBe(1);
});
test("source removal during actual generated normalization cannot commit a cache and preserves ordinary attachment owners",async({request})=>{
  await start(true);const s=await connect(request);
  const ordinary=await sharp({create:{width:32,height:32,channels:3,background:"red"}}).png().toBuffer();
  const added=await post(request,s.csrf,"message",{revision:s.revision,speaker:"Fixture",text:"Ordinary owned source",attachment:{mime:"image/png",base64:ordinary.toString("base64"),category:"image"}});
  const initial=await added.json() as LocalState;
  const r=await post(request,s.csrf,"generation/review",{revision:initial.revision,draftRevision:0,draft:{...offlineDraft(),output:"gif"}}),review=await r.json() as LocalGenerationReview;
  const generated=await post(request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true}),result=await generated.json() as LocalGenerationStatus;
  expect(result.animation).toBeDefined();
  const p=await post(request,s.csrf,"generation/preview",{revision:review.revision,assetId:result.image!.assetId,variant:"animation",caption:"Owned local motion",alt:"Local pan/zoom",speaker:"Fixture"});
  const inserted=await post(request,s.csrf,"generation/insert",{revision:review.revision,handle:(await p.json()).handle}),room=await inserted.json() as LocalState;
  const selected=room.messages[1],preferences={source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""};
  const pending=post(request,s.csrf,"review",{revision:room.revision,command:"explainVisual",selectedId:selected.id,input:{intent:"Explain this owned fixture",context:[],preferences}});
  await expect.poll(()=>app!.resources().nativeBusy,{intervals:[1,5,10]}).toBe(true);
  const current=await post(request,s.csrf,"state",{}),currentRoom=await current.json() as LocalState;
  const removed=await post(request,s.csrf,"remove",{revision:currentRoom.revision,id:selected.id});expect(removed.status()).toBe(200);
  expect((await pending).status()).toBe(400);
  expect(app!.resources()).toMatchObject({generatedBytes:0,cacheGroups:0,nativeBusy:false});
  expect((await request.get(origin+result.image!.posterUrl)).status()).toBe(400);
  const state=await post(request,s.csrf,"state",{}),remaining=await state.json() as LocalState;expect(remaining.messages).toHaveLength(1);
  const ordinaryReview=await post(request,s.csrf,"review",{revision:remaining.revision,command:"explainVisual",selectedId:initial.messages[0].id,input:{intent:"Original ordinary attachment",context:[],preferences}});
  expect(ordinaryReview.status()).toBe(200);expect((await ordinaryReview.json()).media.samples[0].width).toBe(32);
  expect(app!.generationCounters.providerRequests).toBe(1);expect(app!.counters.providerRequests).toBe(0);
});
test("four ephemeral sessions and forty local messages remain hard caps",async({request,browser})=>{
  await start();const s=await connect(request);let revision=s.revision;
  for(let i=0;i<40;i++){
    const response=await post(request,s.csrf,"message",{revision,speaker:"Fixture",text:`Fabricated ${i}`});
    expect(response.status()).toBe(200);revision=(await response.json()).revision;
  }
  expect((await post(request,s.csrf,"message",{revision,speaker:"Fixture",text:"One too many"})).status()).toBe(400);
  const contexts=[];
  for(let i=0;i<4;i++){
    const context=await browser.newContext();contexts.push(context);
    const response=await context.request.post(origin+"/local/session",{headers:{Origin:origin},data:{}});
    expect(response.status()).toBe(i<3?200:400);
  }
  expect(app!.resources().sessions).toBe(4);expect(app!.generationCounters.providerRequests).toBe(0);
  for(const context of contexts)await context.close();
});
test("isolated preview ports cannot overwrite another live room's browser cookie",async({request})=>{
  await start();const firstOrigin=origin,s=await connect(request);
  await post(request,s.csrf,"message",{revision:s.revision,speaker:"Fixture",text:"Preserve this independent owned test room"});
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const second=await createLocalChatServer("OFFLINE-FAKE-CREDENTIAL",{clientRoot:resolve(buildRoot,"client"),transport:async()=>{throw Error("No paid call permitted");}});
  try{
    const otherOrigin=await second.start(0);
    const other=await request.post(otherOrigin+"/local/session",{headers:{Origin:otherOrigin},data:{}});
    expect(other.status()).toBe(200);expect(other.headers()["set-cookie"]).toContain(`local_chat_${new URL(otherOrigin).port}=`);
    const original=await request.post(firstOrigin+"/local/state",{headers:{Origin:firstOrigin,"X-Local-CSRF":s.csrf},data:{}});
    expect(original.status()).toBe(200);expect((await original.json()).messages[0].text).toBe("Preserve this independent owned test room");
  }finally{await second.close();}
});
