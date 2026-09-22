import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import type {LocalState} from "../../src/shared/local-chat";

const root=process.env.VISUAL_BUILD_ROOT??"dist";
test.setTimeout(45_000);
let app:Awaited<ReturnType<typeof Factory>>,origin:string,providerCalls:number;
test.beforeEach(async()=>{
  providerCalls=0;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(pathToFileURL(resolve(root,"server","local-chat-server.js")).href);
  const denied=async()=>{providerCalls++;throw new Error("Unexpected provider call in synchronization test");};
  app=await createLocalChatServer("OFFLINE-SYNC-TEST",{
    clientRoot:resolve(root,"client"),interaction:"direct-personal",catalogSource:"original-demo",
    contextualCreation:true,creationChoices:true,mixedCreation:true,emojiExpressions:true,
    transport:denied,memeTransport:denied,webSearchTransport:denied
  });
  origin=await app.start(0);
});
test.afterEach(async()=>{await app.close();expect(providerCalls).toBe(0);});
async function open(page:Page){
  await page.goto(origin+"/chat");
  await expect(page.getByRole("textbox",{name:"Message",exact:true})).toBeEnabled();
}
async function api(page:Page,path:string,body:object={}):Promise<LocalState>{
  return page.evaluate(async({path,body})=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
      body:JSON.stringify(path==="session/close"?{}:{revision:session.revision,...body})});
    if(!response.ok)throw new Error(`Local test API ${path}: ${response.status}`);
    return response.json();
  },{path,body});
}
const timeline=(page:Page)=>page.locator(".local-messages");
async function send(page:Page,text:string){
  await page.getByRole("textbox",{name:"Message",exact:true}).fill(text);
  await page.getByRole("button",{name:"Add locally",exact:true}).click();
  await expect(timeline(page)).toContainText(text);
}
async function visibility(page:Page,value:"hidden"|"visible"){
  await page.evaluate(value=>{
    Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>value});
    document.dispatchEvent(new Event("visibilitychange"));
    if(value==="visible")window.dispatchEvent(new Event("focus"));
  },value);
}

test("same-cookie pages sync messages, edits, removal and reset while keeping local drafts and speaker",async({page,context,browser})=>{
  await open(page);const peer=await context.newPage();await open(peer);
  const isolated=await browser.newContext();const stranger=await isolated.newPage();await open(stranger);
  await peer.getByLabel("Simulated speaker",{exact:true}).fill("Morgan");
  await expect(peer.getByRole("button",{name:"Add locally",exact:true})).toBeDisabled();
  await peer.getByRole("textbox",{name:"Message",exact:true}).fill("Unsent local draft");
  await expect(peer.getByRole("button",{name:"Add locally",exact:true})).toBeEnabled();
  await peer.getByLabel("Attach visual",{exact:true}).setInputFiles({name:"draft.png",mimeType:"image/png",
    buffer:await sharp({create:{width:32,height:32,channels:3,background:"#579"}}).png().toBuffer()});
  await expect(peer.getByRole("img",{name:"Attachment preview",exact:true})).toBeVisible();
  // Let the originating page observe the speaker mutation before its next write.
  await expect(page.getByText("Conversation updated in another window.",{exact:false})).toBeVisible();
  await send(page,"Shared first message");
  await expect(timeline(peer)).toContainText("Shared first message");
  const state=await api(page,"state"),id=state.messages[0].id;
  await api(page,"edit",{id,speaker:"Alex",text:"Shared edited message"});
  await expect(timeline(peer)).toContainText("Shared edited message");
  await expect(timeline(peer)).not.toContainText("Shared first message");
  await api(page,"remove",{id});
  await expect(timeline(peer)).not.toContainText("Shared edited message");
  await api(page,"message",{speaker:"Alex",text:"Before reset"});
  await expect(timeline(peer)).toContainText("Before reset");
  await api(page,"reset");
  await expect(timeline(peer)).not.toContainText("Before reset");
  await expect(peer.getByRole("textbox",{name:"Message",exact:true})).toHaveValue("Unsent local draft");
  await expect(peer.getByLabel("Simulated speaker",{exact:true})).toHaveValue("Morgan");
  await expect(peer.getByRole("img",{name:"Attachment preview",exact:true})).toBeVisible();
  await expect(timeline(stranger).locator("article")).toHaveCount(0);
  expect((await api(stranger,"state")).messages).toHaveLength(0);
  await isolated.close();
});

test("removing the message being edited preserves its unsent text as a new draft",async({page,context})=>{
  await open(page);await send(page,"Original editable message");
  const peer=await context.newPage();await open(peer);
  await timeline(peer).getByRole("button",{name:"Edit",exact:true}).click();
  await expect(peer.getByRole("button",{name:"Save edit",exact:true})).toBeEnabled();
  await peer.getByRole("textbox",{name:"Message",exact:true}).fill("My unfinished edit");
  const current=await api(page,"state");await api(page,"remove",{id:current.messages[0].id});
  await expect(timeline(peer)).not.toContainText("Original editable message");
  await expect(peer.getByRole("textbox",{name:"Message",exact:true})).toHaveValue("My unfinished edit");
  await expect(peer.getByRole("button",{name:"Add locally",exact:true})).toBeEnabled();
});

test("peer profile and conversation updates preserve unsaved profile and expression inputs",async({page,context})=>{
  await open(page);const peer=await context.newPage();await open(peer);
  await peer.getByRole("button",{name:"Express",exact:true}).click();
  await peer.locator(".speaker-profile > summary").click();
  await peer.getByLabel("Voluntary cultural context",{exact:true}).fill("My unsaved voluntary report");
  await expect(peer.getByRole("button",{name:"Save speaker profile",exact:true})).toBeEnabled();
  await api(page,"speaker/profile",{speaker:"Alex",profile:{language:"en",culture:"Peer saved report",familiarity:"",tone:"",humor:"",avoid:""}});
  await api(page,"message",{speaker:"Alex",text:"New peer context"});
  await expect(timeline(peer)).toContainText("New peer context");
  await expect(peer.getByLabel("Voluntary cultural context",{exact:true})).toHaveValue("My unsaved voluntary report");
  await peer.getByRole("button",{name:"Discard profile edits",exact:true}).click();
  await expect(peer.getByLabel("Voluntary cultural context",{exact:true})).toHaveValue("Peer saved report");
  const intent=peer.locator(".unified-expression textarea").first();
  await intent.fill("A local expression draft");
  await api(page,"message",{speaker:"Maya",text:"Another peer message"});
  await expect(timeline(peer)).toContainText("Another peer message");
  await expect(intent).toHaveValue("A local expression draft");
});

test("a delayed pre-action snapshot cannot roll back a locally committed message",async({page,context})=>{
  await open(page);const peer=await context.newPage();await open(peer);
  let release!:()=>void,arrived!:()=>void;
  const held=new Promise<void>(resolve=>release=resolve),captured=new Promise<void>(resolve=>arrived=resolve);
  let first=true;
  await peer.route("**/local/state",async route=>{
    if(!first){await route.continue();return;}first=false;
    const response=await route.fetch();arrived();await held;await route.fulfill({response});
  });

  await captured;
  await send(peer,"Locally committed during held poll");
  release();
  await peer.waitForTimeout(1900);
  await expect(timeline(peer)).toContainText("Locally committed during held poll");
  await expect(timeline(page)).toContainText("Locally committed during held poll");
});

test("polling waits for this window's in-flight mutation rather than invalidating its response",async({page,context})=>{
  await open(page);const peer=await context.newPage();await open(peer);
  let release!:()=>void,arrived!:()=>void;
  const held=new Promise<void>(resolve=>release=resolve),committed=new Promise<void>(resolve=>arrived=resolve);
  await peer.route("**/local/message",async route=>{
    const response=await route.fetch();arrived();await held;await route.fulfill({response});
  });
  let reads=0;peer.on("request",request=>{if(request.url().endsWith("/local/state"))reads++;});
  await peer.getByRole("textbox",{name:"Message",exact:true}).fill("Slow local acknowledgement");
  await peer.getByRole("button",{name:"Add locally",exact:true}).click();
  await committed;const before=reads;
  try{
    await expect(timeline(page)).toContainText("Slow local acknowledgement");
    await peer.waitForTimeout(1800);
    expect(reads).toBe(before);
    await expect(peer.getByRole("textbox",{name:"Message",exact:true})).toHaveValue("Slow local acknowledgement");
  }finally{release();}
  await expect(timeline(peer)).toContainText("Slow local acknowledgement");
  await expect(peer.getByRole("textbox",{name:"Message",exact:true})).toHaveValue("");
});

test("hidden pages stop polling and resume on visibility/focus without cancellation or AI",async({page,context})=>{
  await open(page);const peer=await context.newPage();await open(peer);
  let observations=0,cancellations=0;
  peer.on("request",request=>{
    if(request.url().endsWith("/local/state"))observations++;
    if(/\/local\/(?:cancel|preview\/cancel)$/.test(request.url()))cancellations++;
  });
  await visibility(peer,"hidden");
  await peer.waitForTimeout(1800);expect(observations).toBe(0);
  await api(page,"message",{speaker:"Alex",text:"Arrived while hidden"});
  await expect(timeline(peer)).not.toContainText("Arrived while hidden");
  await visibility(peer,"visible");
  await expect(timeline(peer)).toContainText("Arrived while hidden");
  expect(observations).toBe(1);expect(cancellations).toBe(0);
  await peer.goto("about:blank");const unmounted=observations;
  await peer.waitForTimeout(1800);expect(observations).toBe(unmounted);
});

for(const terminal of ["close","expired-cookie"] as const){
  test(`${terminal} stops observation and requires explicit reconnection, preserving drafts`,async({page,context})=>{
    await open(page);const peer=await context.newPage();await open(peer);
    await peer.getByRole("textbox",{name:"Message",exact:true}).fill("Keep after expiry");
    let observations=0,sessions=0;
    peer.on("request",request=>{
      if(request.url().endsWith("/local/state"))observations++;
      if(request.url().endsWith("/local/session"))sessions++;
    });
    if(terminal==="close")await api(page,"session/close");
    else {
      const cookie=(await context.cookies()).find(cookie=>cookie.name.startsWith("local_chat"))!;
      await context.addCookies([{...cookie,expires:Math.floor(Date.now()/1000)-1}]);
    }
    await expect(peer.getByRole("button",{name:"Retry connection",exact:true})).toBeVisible();
    await expect(peer.getByRole("textbox",{name:"Message",exact:true})).toBeDisabled();
    await expect(peer.getByRole("textbox",{name:"Message",exact:true})).toHaveValue("Keep after expiry");
    const stopped=observations;
    await peer.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await peer.waitForTimeout(3300);
    expect(observations).toBe(stopped);expect(sessions).toBe(0);
  });
}

test("transient refresh failures are visible and back off instead of focus-triggered retry loops",async({page,context})=>{
  await open(page);const peer=await context.newPage();await open(peer);
  let requests=0;
  await peer.route("**/local/state",async route=>{
    requests++;if(requests===1)await route.abort("failed");else await route.continue();
  });
  await expect(peer.getByRole("alert").filter({hasText:"Conversation refresh failed"})).toBeVisible();
  await peer.evaluate(()=>{for(let i=0;i<10;i++)window.dispatchEvent(new Event("focus"));});
  await peer.waitForTimeout(500);expect(requests).toBe(1);
  await api(page,"message",{speaker:"Alex",text:"Recovered after backoff"});
  await expect(timeline(peer)).toContainText("Recovered after backoff",{timeout:8000});
  await expect(peer.getByRole("alert").filter({hasText:"Conversation refresh failed"})).toHaveCount(0);
  expect(requests).toBe(2);
});
