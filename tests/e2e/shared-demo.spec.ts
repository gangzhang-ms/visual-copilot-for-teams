import {test,expect,type Page} from "@playwright/test";
import {mock} from "node:test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {offlineDraft} from "../../src/server/generation.test.support";

const root=process.env.VISUAL_BUILD_ROOT??"dist";
test.setTimeout(45_000);
let app:Awaited<ReturnType<typeof Factory>>,origin:string,textCalls:number,imageCalls:number;
test.beforeEach(async()=>{
  textCalls=0;imageCalls=0;
  const built=(name:string)=>pathToFileURL(resolve(root,"server",name)).href;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const denied=async()=>{textCalls++;throw new Error("No external or text provider calls in shared-room tests");};
  const png=await sharp({create:{width:1024,height:1024,channels:3,background:"#375"}}).png().toBuffer();
  app=await createLocalChatServer("OFFLINE-SHARED-DEMO",{
    sharedDemo:true,clientRoot:resolve(root,"client"),interaction:"direct-personal",catalogSource:"original-demo",
    transport:denied,memeTransport:denied,webSearchTransport:denied,
    generation:{...ongoingPersonalGenerationOptions(),transport:async()=>{
      imageCalls++;return Response.json({data:[{b64_json:png.toString("base64")}]});
    }}
  });origin=await app.start(0);
});
test.afterEach(async()=>{await app.close();expect(textCalls).toBe(0);});
async function open(page:Page,id:string){
  await page.goto(`${origin}/chat?chatId=${encodeURIComponent(id)}`);
  await expect(page.getByRole("textbox",{name:"Message",exact:true})).toBeEnabled();
}
async function api(page:Page,path:string,body:object={},revision=true){
  return page.evaluate(async({path,body,revision})=>{
    const query=location.search;
    const session=await(await fetch("/local/session"+query,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const response=await fetch("/local/"+path+query,{method:"POST",
      headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
      body:JSON.stringify(revision?{revision:session.revision,...body}:body)});
    return {status:response.status,value:await response.json()};
  },{path,body,revision});
}
async function send(page:Page,text:string){
  await page.getByRole("textbox",{name:"Message",exact:true}).fill(text);
  await page.getByRole("button",{name:"Add locally",exact:true}).click();
  await expect(page.locator(".local-messages")).toContainText(text);
}

test("independent profiles join by chosen ID, exchange/edit/delete, reload and share without cookies or AI",async({page,browser})=>{
  let joins=0;page.on("request",request=>{if(new URL(request.url()).pathname==="/local/session")joins++;});
  await page.goto(origin+"/chat");
  await expect(page.getByRole("note")).toContainText("Anyone knowing the Chat ID");
  await page.waitForTimeout(1700);expect(joins).toBe(0);
  await page.getByLabel("Chat ID",{exact:true}).fill("demo123");
  await page.getByRole("button",{name:"Create / join Chat ID",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"Message",exact:true})).toBeEnabled();
  const other=await browser.newContext(),peer=await other.newPage();await open(peer,"demo123");
  await peer.getByRole("textbox",{name:"Message",exact:true}).fill("Unsent peer draft");
  await send(page,"Across independent profiles");
  await expect(peer.locator(".local-messages")).toContainText("Across independent profiles");
  const id=(await api(page,"state",{},false)).value.messages[0].id;
  expect((await api(page,"edit",{id,speaker:"Alex",text:"Edited across profiles"})).status).toBe(200);
  await expect(peer.locator(".local-messages")).toContainText("Edited across profiles");
  expect((await api(page,"remove",{id})).status).toBe(200);
  await expect(peer.locator(".local-messages article")).toHaveCount(0);
  await expect(peer.getByRole("textbox",{name:"Message",exact:true})).toHaveValue("Unsent peer draft");
  await peer.getByRole("button",{name:"Add locally",exact:true}).click();
  await expect(page.locator(".local-messages")).toContainText("Unsent peer draft");
  await expect(page.getByLabel("Share URL",{exact:true})).toHaveValue(origin+"/chat?chatId=demo123");
  await page.context().grantPermissions(["clipboard-read","clipboard-write"],{origin});
  await page.getByRole("button",{name:"Copy share URL",exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(origin+"/chat?chatId=demo123");
  await page.reload();await expect(page.locator(".local-messages")).toContainText("Unsent peer draft");
  expect((await page.context().cookies()).filter(c=>c.name.startsWith("local_chat"))).toHaveLength(0);
  expect((await other.cookies()).filter(c=>c.name.startsWith("local_chat"))).toHaveLength(0);
  expect(imageCalls).toBe(0);await other.close();
});

test("concurrent first joins converge on one room without replacing an incarnation",async({request})=>{
  const responses=await Promise.all(Array.from({length:8},()=>request.post(origin+"/local/session?chatId=concurrent_demo",
    {headers:{Origin:origin},data:{}})));
  const rooms=await Promise.all(responses.map(response=>{expect(response.status()).toBe(200);return response.json();}));
  expect(new Set(rooms.map(room=>room.csrf)).size).toBe(1);
  expect(new Set(rooms.map(room=>room.sharedRoom.expiresAt)).size).toBe(1);
  expect(app.resources().sessions).toBe(1);expect(imageCalls).toBe(0);
});

test("different IDs stay isolated in the SAME browser; switch confirmation preserves a cancelled draft",async({page,context})=>{
  await open(page,"alpha");
  const second=await context.newPage();await open(second,"beta");
  await send(page,"Only alpha");await send(second,"Only beta");
  await page.waitForTimeout(1900);
  await expect(page.locator(".local-messages")).not.toContainText("Only beta");
  await expect(second.locator(".local-messages")).not.toContainText("Only alpha");
  await page.getByRole("textbox",{name:"Message",exact:true}).fill("Keep if switching cancelled");
  await page.getByLabel("Chat ID",{exact:true}).fill("beta");
  page.once("dialog",dialog=>dialog.dismiss());
  await page.getByRole("button",{name:"Switch / join Chat ID",exact:true}).click();
  await expect(page).toHaveURL(origin+"/chat?chatId=alpha");
  await expect(page.getByRole("textbox",{name:"Message",exact:true})).toHaveValue("Keep if switching cancelled");
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Switch / join Chat ID",exact:true}).click();
  await expect(page).toHaveURL(origin+"/chat?chatId=beta");
  await expect(page.locator(".local-messages")).toContainText("Only beta");
  expect(imageCalls).toBe(0);
});

test("invalid or ambiguous IDs and missing/wrong CSRF or Origin are rejected without room creation",async({page,request})=>{
  await page.goto(origin+"/chat");
  await page.getByLabel("Chat ID",{exact:true}).fill("bad room");
  await page.getByRole("button",{name:"Create / join Chat ID",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("1–64 ASCII");
  for(const query of ["","?chatId=","?chatId="+encodeURIComponent("x".repeat(65)),"?chatId=bad%0A","?chatId=a/b",
    "?chatId=%E4%B8%AD","?chatId=a&chatId=b","?chatId=a&extra=b"]){
    const response=await request.post(origin+"/local/session"+query,{headers:{Origin:origin},data:{}});
    expect(response.status()).toBe(400);
  }
  expect(app.resources().sessions).toBe(0);
  await open(page,"valid_id-1");
  const join=await request.post(origin+"/local/session?chatId=valid_id-1",{headers:{Origin:origin},data:{}});
  const current=await join.json();
  const invalidHeaders:Record<string,string>[]=[{Origin:origin},{Origin:origin,"X-Local-CSRF":"wrong"},
    {Origin:"https://elsewhere.invalid","X-Local-CSRF":current.csrf}];
  for(const headers of invalidHeaders){
    const response=await request.post(origin+"/local/message?chatId=valid_id-1",{headers,data:{revision:current.revision,speaker:"Alex",text:"Forbidden"}});
    expect(response.status()).toBe(400);
  }
  await request.post(origin+"/local/session?chatId=other",{headers:{Origin:origin},data:{}});
  const wrongRoom=await request.post(origin+"/local/state?chatId=other",{headers:{Origin:origin,"X-Local-CSRF":current.csrf},data:{}});
  expect(wrongRoom.status()).toBe(400);
  expect((await api(page,"state",{},false)).value.messages).toHaveLength(0);
  expect(imageCalls).toBe(0);
});

test("leaving does not erase peers; clearing requires explicit shared-impact confirmation",async({page,browser})=>{
  await open(page,"leave_demo");const other=await browser.newContext(),peer=await other.newPage();await open(peer,"leave_demo");
  await send(page,"Survives leaving");await expect(peer.locator(".local-messages")).toContainText("Survives leaving");
  const before=(await api(peer,"state",{},false)).value;
  page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Leave this tab",exact:true}).click();
  await expect(page.getByRole("button",{name:"Create / join Chat ID",exact:true})).toBeVisible();
  const after=(await api(peer,"state",{},false)).value;
  expect(after.revision).toBe(before.revision);expect(after.messages).toEqual(before.messages);
  expect((await api(peer,"reset")).status).toBe(400);
  peer.once("dialog",dialog=>dialog.dismiss());await peer.getByRole("button",{name:"Clear room",exact:true}).click();
  await expect(peer.locator(".local-messages")).toContainText("Survives leaving");
  peer.once("dialog",dialog=>dialog.accept());await peer.getByRole("button",{name:"Clear room",exact:true}).click();
  await expect(peer.locator(".local-messages article")).toHaveCount(0);
  expect(imageCalls).toBe(0);await other.close();
});

test("uploads and generated image/poster URLs resolve in the explicit room, not another tab's room",async({page,context,browser})=>{
  await open(page,"media_alpha");const wrong=await context.newPage();await open(wrong,"media_beta");
  const upload=await sharp({create:{width:48,height:48,channels:3,background:"#957"}}).png().toBuffer();
  expect((await api(page,"message",{speaker:"Alex",text:"Owned upload",attachment:{mime:"image/png",base64:upload.toString("base64"),category:"image"}})).status).toBe(200);
  const review=await api(page,"generation/review",{draftRevision:0,draft:offlineDraft()});
  expect(review.status).toBe(200);
  const generated=await api(page,"generation/process",{operationId:review.value.operationId,digest:review.value.digest,consent:true},false);
  expect(generated.status).toBe(200);expect(generated.value.status).toBe("ready");
  const image=generated.value.image;
  for(const url of [image.mediaUrl,image.posterUrl]){
    expect(url).toContain("?chatId=media_alpha");
    expect((await context.request.get(origin+url)).status()).toBe(200);
    expect((await context.request.get(origin+url.replace("media_alpha","media_beta"))).status()).toBe(400);
    expect((await context.request.get(origin+url.split("?")[0])).status()).toBe(400);
  }
  const preview=await api(page,"generation/preview",{assetId:image.assetId,variant:"image",speaker:"Alex",caption:"Separate caption",alt:"Original offline fixture"});
  expect(preview.status).toBe(200);
  expect((await api(page,"generation/insert",{handle:preview.value.handle})).status).toBe(200);
  const other=await browser.newContext(),peer=await other.newPage();await open(peer,"media_alpha");
  await expect(peer.locator(".local-messages")).toContainText("Owned upload");
  await expect(peer.locator(".local-messages")).toContainText("Separate caption");
  const images=peer.locator(".local-messages img");
  await expect.poll(()=>images.evaluateAll(images=>images.filter(image=>image instanceof HTMLImageElement&&image.complete&&image.naturalWidth>0).length)).toBeGreaterThanOrEqual(2);
  expect((await api(wrong,"state",{},false)).value.messages).toHaveLength(0);
  expect(imageCalls).toBe(1);await other.close();
});

test("room TTL is fixed at creation; expiry stops observers and explicit rejoin creates a fresh incarnation",async({page,request})=>{
  await open(page,"expiry_demo");
  const first=await request.post(origin+"/local/session?chatId=expiry_demo",{headers:{Origin:origin},data:{}});
  const old=await first.json();
  expect(old.sharedRoom.expiresAt-Date.now()).toBeGreaterThan(1_790_000);
  await send(page,"Expires with this room");
  const again=await request.post(origin+"/local/session?chatId=expiry_demo",{headers:{Origin:origin},data:{}});
  expect((await again.json()).sharedRoom.expiresAt).toBe(old.sharedRoom.expiresAt);
  const clock=mock.method(Date,"now",()=>old.sharedRoom.expiresAt+1);
  try{
    await expect(page.getByRole("button",{name:"Retry connection",exact:true})).toBeVisible();
    expect(app.resources().sessions).toBe(0);
    const expired=await request.post(origin+"/local/state?chatId=expiry_demo",{headers:{Origin:origin,"X-Local-CSRF":old.csrf},data:{}});
    expect(expired.status()).toBe(400);expect(app.resources().sessions).toBe(0);
    const joined=await request.post(origin+"/local/session?chatId=expiry_demo",{headers:{Origin:origin},data:{}});
    const fresh=await joined.json();expect(fresh.messages).toHaveLength(0);expect(fresh.csrf).not.toBe(old.csrf);
    const stale=await request.post(origin+"/local/state?chatId=expiry_demo",{headers:{Origin:origin,"X-Local-CSRF":old.csrf},data:{}});
    expect(stale.status()).toBe(400);
  }finally{clock.mock.restore();}
  expect(imageCalls).toBe(0);
});
