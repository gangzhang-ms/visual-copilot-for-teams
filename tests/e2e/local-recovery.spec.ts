import {test,expect,type BrowserContext,type APIRequestContext} from "@playwright/test";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {offlineDraft} from "../../src/server/generation.test.support";
import {emptySpeakerProfile} from "../../src/shared/expression";
import {openCreate} from "../expression-ui";

let app:Awaited<ReturnType<typeof Factory>>,origin:string,held=false,release:(()=>void)|undefined;
let contexts:BrowserContext[]=[];
const realNow=Date.now,root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
test.beforeEach(async({},testInfo)=>{
  contexts=[];held=false;release=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));expect(localPaidLease.busy).toBe(false);localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const bytes=await sharp({create:{width:1024,height:1024,channels:3,background:"white"}}).png().toBuffer();
  app=await createLocalChatServer("OFFLINE-RECOVERY-TEST",{...(testInfo.title.startsWith("legacy ")?{}:{interaction:"direct-personal" as const}),clientRoot:resolve(root,"client"),cooldownMs:0,
    transport:async()=>{throw new Error("No decoder request expected");},
    generation:{...ongoingPersonalGenerationOptions(),transport:async()=>{
      if(!held)throw new Error("No image request expected outside held offline case");
      let cancelled=false,finishCancel:(()=>void)|undefined;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller){release=()=>{if(cancelled)finishCancel?.();else{controller.enqueue(new TextEncoder().encode(JSON.stringify({data:[{b64_json:bytes.toString("base64")}]})));controller.close();}}},
        cancel(){cancelled=true;return new Promise<void>(resolve=>{finishCancel=resolve;});}
      }),{headers:{"Content-Type":"application/json"}});
    }}
  });origin=await app.start(0);
});
test.afterEach(async()=>{release?.();release=undefined;await app.close();for(const c of contexts)await c.close();Date.now=realNow;});
const post=(request:APIRequestContext,csrf:string,path:string,data:object={})=>request.post(origin+"/local/"+path,{headers:{Origin:origin,"Content-Type":"application/json",...(csrf?{"X-Local-CSRF":csrf}:{})},data});
async function connect(context:BrowserContext){return (await post(context.request,"","session")).json();}

test("legacy four occupied rooms give explicit capacity recovery; owner close allows retry without losing other rooms",async({browser,page})=>{
  const owners=[];
  for(let i=0;i<4;i++){
    const context=await browser.newContext();contexts.push(context);const session=await connect(context);
    const room=await (await post(context.request,session.csrf,"message",{revision:session.revision,speaker:"Fiction",text:`Owned fixture room ${i}`})).json();
    owners.push({context,session,room});
  }
  await page.goto(origin+"/chat");
  await expect(page.getByRole("alert")).toContainText("All four local session slots");
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await expect(page.getByRole("alert")).toContainText("四个本地会话名额");
  await expect(page.getByRole("alert")).not.toContainText("本地后端不可用");
  await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByRole("alert")).toContainText("All four local session slots");
  await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeDisabled();
  const denied=await post(page.request,"","session");expect((await denied.json()).code).toBe("local-session-capacity");
  expect((await post(owners[0].context.request,"","session/close")).status()).toBe(400);
  expect((await post(owners[0].context.request,owners[1].session.csrf,"session/close")).status()).toBe(400);
  expect((await post(owners[0].context.request,owners[0].session.csrf,"session/close",{owner:"another"})).status()).toBe(400);
  const closed=await post(owners[0].context.request,owners[0].session.csrf,"session/close");
  expect(await closed.json()).toEqual({closed:true});expect(closed.headers()["set-cookie"]).toContain("Max-Age=0");
  await page.getByRole("button",{name:"Retry connection",exact:true}).click();
  await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeEnabled();
  for(const owner of owners.slice(1)){
    const state=await (await post(owner.context.request,owner.session.csrf,"state")).json();
    expect(state.messages[0].text).toBe(owner.room.messages[0].text);
  }
  expect(app.counters.providerRequests).toBe(0);expect(app.generationCounters.providerRequests).toBe(0);
});

test("direct personal admits twelve simultaneous rooms without eviction, preserves messages and profiles, and cleans up owners",async({browser,page})=>{
  const owners=[];
  for(let i=0;i<12;i++){
    const context=await browser.newContext();contexts.push(context);const session=await connect(context);
    expect(session.csrf).toBeTruthy();
    const room=await (await post(context.request,session.csrf,"message",{revision:session.revision,speaker:"Fiction",text:`Synthetic independent room ${i}`})).json();
    const saved=await post(context.request,session.csrf,"speaker/profile",{revision:room.revision,speaker:"Fiction",profile:{...emptySpeakerProfile(),tone:`Quiet encouragement ${i}`}});
    expect(saved.status()).toBe(200);owners.push({context,session,room:await saved.json()});
  }
  expect(app.resources().sessions).toBe(12);
  expect((await (await page.request.get(origin+"/healthz")).json()).sessionAdmission).toBe("no-count-quota");
  await page.goto(origin+"/chat");await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeEnabled();
  await expect(page.locator(".local-bootstrap")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("All four local session slots");
  await openCreate(page);
  await page.locator(".speaker-profile summary").click();
  await page.getByLabel("Speaker tone",{exact:true}).fill("Quiet appreciation");
  await page.getByRole("button",{name:"Save speaker profile",exact:true}).click();
  await expect(page.locator(".speaker-profile summary")).toContainText("self-reported");
  expect(app.resources().sessions).toBe(13);
  expect((await post(owners[0].context.request,"","session/close")).status()).toBe(400);
  expect((await post(owners[0].context.request,owners[1].session.csrf,"session/close")).status()).toBe(400);
  expect((await post(owners[0].context.request,owners[0].session.csrf,"session/close",{owner:"another"})).status()).toBe(400);
  for(const owner of owners){
    const state=await (await post(owner.context.request,owner.session.csrf,"state")).json();
    expect(state.messages).toEqual(owner.room.messages);
    expect(state.speakerProfiles).toEqual(owner.room.speakerProfiles);
    expect((await post(owner.context.request,owner.session.csrf,"session/close")).status()).toBe(200);
  }
  page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Close this room",exact:true}).click();
  await expect.poll(()=>app.resources().sessions).toBe(0);
  expect(app.resources()).toMatchObject({retiringSessions:0,generatedBytes:0,nativeBusy:false,paidBusy:false});
  expect(app.counters.providerRequests).toBe(0);expect(app.generationCounters.providerRequests).toBe(0);
});

test("pending bootstrap blocks edits and is independent from request epochs and language changes",async({page})=>{
  let resume!:()=>void;const gate=new Promise<void>(resolve=>{resume=resolve;});
  const posts:string[]=[];page.on("request",r=>{if(r.method()==="POST")posts.push(new URL(r.url()).pathname);});
  await page.route(origin+"/local/session",async route=>{await gate;await route.continue();},{times:1});
  await page.goto(origin+"/chat");
  await expect(page.getByRole("status")).toContainText("Opening your local session");
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await expect(page.getByRole("status")).toContainText("正在打开本地会话");
  await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeDisabled();
  await expect(page.getByLabel("Message",{exact:true})).toBeDisabled();
  await page.locator(".local-composer").dispatchEvent("submit");
  resume();
  await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeEnabled();
  await expect(page.locator(".local-bootstrap")).toHaveCount(0);
  expect(posts).toEqual(["/local/session"]);expect(app.counters.providerRequests).toBe(0);
});

test("expired rooms are reaped at admission without waiting for timer or evicting a newer room",async({browser})=>{
  const base=realNow();let now=base;Date.now=()=>now;
  for(let i=0;i<3;i++){const c=await browser.newContext();contexts.push(c);await connect(c);}
  now=base+29*60_000;
  const fresh=await browser.newContext();contexts.push(fresh);const s=await connect(fresh);
  const room=await (await post(fresh.request,s.csrf,"message",{revision:s.revision,speaker:"Fiction",text:"Keep this newer fixture room"})).json();
  now=base+31*60_000;
  const newcomer=await browser.newContext();contexts.push(newcomer);
  expect((await connect(newcomer)).csrf).toBeTruthy();
  expect(app.resources().sessions).toBe(2);
  expect((await (await post(fresh.request,s.csrf,"state")).json()).messages).toEqual(room.messages);
});

test("closing a direct owner retains native/paid leases but does not block new sessions while cleanup is pending",async({browser})=>{
  const owners=[];
  for(let i=0;i<4;i++){const c=await browser.newContext();contexts.push(c);owners.push({c,s:await connect(c)});}
  held=true;const {c,s}=owners[0];
  const review=await (await post(c.request,s.csrf,"generation/review",{revision:s.revision,draftRevision:0,draft:offlineDraft()})).json();
  const pending=post(c.request,s.csrf,"generation/process",{operationId:review.operationId,digest:review.digest,consent:true});
  await expect.poll(()=>app.generationCounters.providerRequests).toBe(1);
  expect((await post(c.request,s.csrf,"session/close")).status()).toBe(200);
  expect(app.resources()).toMatchObject({sessions:3,retiringSessions:1,nativeBusy:true,paidBusy:true});
  const fifth=await browser.newContext();contexts.push(fifth);
  expect((await connect(fifth)).csrf).toBeTruthy();
  expect(app.resources()).toMatchObject({sessions:4,retiringSessions:1,nativeBusy:true,paidBusy:true});
  release!();release=undefined;await pending;
  expect(app.resources().nativeBusy).toBe(false);expect(app.resources().paidBusy).toBe(false);
  expect((await connect(fifth)).csrf).toBeTruthy();expect(app.resources().retiringSessions).toBe(0);
});

test("shared browser cleanup releases rooms on success and failure and never allocates during finally",async({browser})=>{
  const {ownedBrowserSession}=await import(pathToFileURL(resolve("scripts","local-browser-session.mjs")).href);
  for(let i=0;i<6;i++){
    const c=await browser.newContext();contexts.push(c);const page=await c.newPage(),owned=ownedBrowserSession(page,origin);
    try{
      await owned.start();await page.goto(origin+"/chat");await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeEnabled();
      if(i%2===1)throw new Error("controlled fixture failure");
    }catch(e){if(!(e instanceof Error)||e.message!=="controlled fixture failure")throw e;}
    finally{expect((await owned.close()).closed).toBe(true);}
    expect(app.resources().sessions).toBe(0);
  }
  const c=await browser.newContext();contexts.push(c);const owned=ownedBrowserSession(await c.newPage(),origin);
  await owned.start();expect(await owned.close()).toEqual({closed:false,notCreated:true});expect(app.resources().sessions).toBe(0);
  expect(app.counters.providerRequests).toBe(0);expect(app.generationCounters.providerRequests).toBe(0);
});

test("explicit own-room close clears its capability and allows deliberate reopen",async({page})=>{
  await page.goto(origin+"/chat");await page.getByLabel("Language / 语言").selectOption("en");
  await page.getByLabel("Message",{exact:true}).fill("Own synthetic disposable room");await page.getByLabel("Message",{exact:true}).press("Enter");
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Close this room",exact:true}).click();
  await expect(page.getByRole("heading",{name:"This room is closed",exact:true})).toBeVisible();
  expect(app.resources().sessions).toBe(0);
  await page.getByRole("button",{name:"Open a new local room",exact:true}).click();
  await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  await expect(page.getByTestId("chat-message")).toHaveCount(0);expect(app.resources().sessions).toBe(1);
});
