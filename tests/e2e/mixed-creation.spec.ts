import {expect,test,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {offlineDraft} from "../../src/server/generation.test.support";
import {openCreate,openCreationOptions,waitForLocalSession} from "../expression-ui";
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,sourceBytes:Buffer;
let calls:string[],sources:{url:string;init?:RequestInit}[],failAt:number,sourceFailure:boolean,holdAt:number,holdSource:boolean;
let selections:string[],selectionId:string|null,selectionStatus:number,unsafeImage:boolean,holdSelection:boolean,releaseSelection:(()=>void)|undefined;
let release:(()=>void)|undefined,releaseSource:(()=>void)|undefined;
test.beforeEach(async()=>{
  calls=[];sources=[];failAt=0;sourceFailure=false;holdAt=0;holdSource=false;release=undefined;releaseSource=undefined;
  selections=[];selectionId="135256802";selectionStatus=200;unsafeImage=false;holdSelection=false;releaseSelection=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));
  expect(localPaidLease.busy).toBe(false);localPaidLease.providerNextAt=0;localPaidLease.nextAt=0;
  const svg=(size:number,color:string)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#ddccaa"/><circle cx="${size/3}" cy="${size/2}" r="${size/4}" fill="${color}"/></svg>`);
  sourceBytes=await sharp(svg(300,"#246789")).jpeg().toBuffer();
  const generated=await Promise.all(["#903060","#205090"].map(color=>sharp(svg(1024,color)).png().toBuffer()));
  app=await createLocalChatServer("OFFLINE-MIXED-ROUTES",{
    clientRoot:resolve(root,"client"),interaction:"direct-personal",creationChoices:true,mixedCreation:true,semanticCreation:true,cooldownMs:0,catalogSource:"original-demo",
    transport:async(_url,init)=>{
      selections.push(String(init?.body));
      const request=JSON.parse(String(init?.body)),input=JSON.parse(request.messages[1].content[0].text);
      expect(input.task).toBe("select-existing-template");
      expect(request.messages[1].content).toHaveLength(1);
      expect(input.catalog).toHaveLength(15);
      expect(input.catalog.at(-1).id).toBe("135256802");
      expect(request.response_format.json_schema.strict).toBe(true);
      expect(app.resources().paidBusy).toBe(true);
      if(holdSelection)await new Promise<void>(resolve=>{releaseSelection=resolve;});
      if(selectionStatus!==200)return new Response("",{status:selectionStatus});
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({id:selectionId,reason:selectionId?"Shared effort fits the expression.":"No suitable template."})}}]}),{headers:{"Content-Type":"application/json"}});
    },
    memeTransport:async(url,init)=>{
      sources.push({url:String(url),init});
      if(holdSource)await new Promise<void>(resolve=>{releaseSource=resolve;});
      if(sourceFailure)return new Response("",{status:503});
      if(String(url).startsWith("https://i.imgflip.com/"))return new Response(unsafeImage?"not an image":new Uint8Array(sourceBytes),{headers:{"Content-Type":"image/jpeg"}});
      return new Response(JSON.stringify({success:true,data:{memes:Array.from({length:15},(_,i)=>({
        id:i===14?"135256802":String(100+i),name:i===14?"Epic Handshake":`Fixture ${i}`,
        url:`https://i.imgflip.com/a${i}.jpg`,width:300,height:300,box_count:2
      }))}}),{headers:{"Content-Type":"application/json"}});
    },
    generation:{...ongoingPersonalGenerationOptions(),transport:async(_url,init)=>{
      calls.push(String(init?.body));const n=calls.length;
      expect(app.resources()).toMatchObject({paidBusy:true,nativeBusy:true});
      if(n===holdAt)await new Promise<void>(resolve=>{release=resolve;});
      if(n===failAt)return new Response("",{status:429,headers:{"retry-after":"30"}});
      return new Response(JSON.stringify({data:[{b64_json:generated[(n-1)%2].toString("base64")}]}),{headers:{"Content-Type":"application/json"}});
    }}
  });origin=await app.start(0);
});
test.afterEach(async()=>{release?.();releaseSource?.();releaseSelection?.();await app.close();});
async function api(page:Page,path:string,body:object={}){
  await waitForLocalSession(page);
  return page.evaluate(async({path,body})=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const noRevision=["state","cancel","session/close","generation/batch/process","generation/batch/status"];
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
      body:JSON.stringify(noRevision.includes(path)?body:{revision:session.revision,...body})});
    return {status:response.status,value:await response.json()};
  },{path,body});
}
async function open(page:Page,language:"en"|"zh-CN"="en"){
  await page.setViewportSize({width:1440,height:950});await page.goto(origin+"/chat");
  if(language!=="en")await page.getByLabel("Language / 语言").selectOption(language);
  await openCreate(page,language,false);
  await page.getByLabel(language==="en"?"What would you like to express?":"你想表达什么？",{exact:true}).fill(
    language==="en"?"Couldn't have pulled that off on my own.":"这次没你们真不行。");
}
for(const language of ["en","zh-CN"] as const)test(`mixed options preserve source pixels, two photo requests and an editable adjacent caption in ${language}`,async({page})=>{
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  await open(page,language);expect(calls.length+sources.length).toBe(0);
  await page.getByRole("button",{name:t("Create 3 options","创建 3 个方案"),exact:true}).click();
  const batch=page.locator(".generation-batch");
  await expect(batch).toContainText(t("3 of 3 ready","3 个方案中已有 3 个就绪"));
  await expect(batch.locator(".generation-candidate")).toHaveCount(3);
  await expect(batch.getByRole("heading",{name:t("Existing image + caption","现成图配文"),exact:true})).toBeVisible();
  expect(calls).toHaveLength(2);expect(sources.map(s=>s.url)).toEqual(["https://api.imgflip.com/get_memes","https://i.imgflip.com/a14.jpg"]);
  for(const source of sources){expect(source.init).toMatchObject({method:"GET",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer"});expect(source.init?.body).toBeUndefined();}
  expect(JSON.stringify(sources)).not.toMatch(/pulled|没你们/);
  expect(selections).toHaveLength(1);
  const selectedInput=JSON.parse(JSON.parse(selections[0]).messages[1].content[0].text);
  expect(selectedInput.intent).toBe(t("Couldn't have pulled that off on my own.","这次没你们真不行。"));
  expect(selectedInput.speakerContext).toMatchObject({role:"outgoing-speaker",profile:null});
  const inputs=calls.map(body=>{const p=JSON.parse(body);expect(Object.keys(p).sort()).toEqual(["n","output_format","prompt","quality","size"]);expect(p.n).toBe(1);return JSON.parse(p.prompt.split("\n").at(-1));});
  expect(inputs.every(i=>i.publicTextInspiration.references[0].name==="Epic Handshake")).toBe(true);
  expect(inputs.every(i=>i.styleDirection.includes("photographic"))).toBe(true);
  expect(inputs[0].styleDirection).not.toBe(inputs[1].styleDirection);
  expect(inputs.every(i=>i.intent===selectedInput.intent)).toBe(true);
  const sourceCard=batch.locator(".existing-candidate"),url=await sourceCard.locator("img").getAttribute("src");
  const image=await page.request.get(origin+url),bytes=await image.body();
  expect(bytes).toEqual(await sharp(sourceBytes).rotate().resize({width:512,height:512,fit:"inside",withoutEnlargement:true}).png().toBuffer());
  await sourceCard.locator("details > summary").click();
  await expect(sourceCard).toContainText(createHash("sha256").update(sourceBytes).digest("base64url"));
  await sourceCard.getByRole("button",{name:t("Use original image + caption","使用原图与配文"),exact:true}).click();
  const caption=t("Couldn't have done it without you!","多亏有你们！");
  await page.getByLabel(t("Caption beside image","图片旁的配文"),{exact:true}).fill(caption);
  await page.getByRole("button",{name:t("Preview original image + caption","预览原图与配文"),exact:true}).click();
  await expect(page.getByRole("region",{name:t("Existing-image insertion preview","现成图插入预览"),exact:true})).toContainText(caption);
  for(const width of [320,556]){
    await page.setViewportSize({width,height:950});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:resolve(".local","visual-context",`mixed-${language}-${width}-mock.png`)});
  }
  await page.getByRole("button",{name:t("Insert original image + caption locally","将原图与配文插入本地"),exact:true}).click();
  await expect(page.getByTestId("chat-message")).toContainText(caption);
  const state=(await api(page,"state")).value;
  expect(state.messages[0].visual.template.name).toBe("Epic Handshake");expect(state.messages[0].generated).toBeUndefined();
  expect((await page.request.get(origin+url)).status()).toBe(200);
  expect(app.resources().generatedBytes).toBe(0);expect(calls).toHaveLength(2);expect(app.counters.providerRequests).toBe(1);
});
test("an existing candidate can be previewed and inserted with zero image calls; reset revokes its ownership",async({page,browser})=>{
  await page.goto(origin+"/chat");
  const review=await api(page,"generation/batch/review",{draft:{...offlineDraft(),intent:"Thanks for the teamwork"},draftRevision:0,count:3,referenceMode:"popular-text"});
  expect(review.status).toBe(200);expect(review.value.existing.status).toBe("ready");expect(calls).toHaveLength(0);
  const {batchId,digest,existing}=review.value;
  const preview=await api(page,"generation/batch/source/preview",{batchId,digest,caption:"Thanks!","speaker":"Alex"});
  expect(preview.status).toBe(200);
  const foreign=await browser.newContext(),other=await foreign.newPage();await other.goto(origin+"/chat");
  expect((await api(other,"generation/batch/source/insert",{handle:preview.value.handle})).status).toBe(400);
  expect((await other.request.get(origin+existing.visual.imageUrl)).status()).not.toBe(200);await foreign.close();
  expect((await api(page,"generation/batch/source/insert",{handle:preview.value.handle})).status).toBe(200);
  const inserted=(await api(page,"state")).value.messages[0];
  expect(inserted).toMatchObject({text:"Thanks!",visual:{id:existing.visual.id}});
  const explain=await api(page,"review",{command:"explainVisual",selectedId:inserted.id,input:{
    intent:"",context:[{label:inserted.id,text:"Alex: Thanks!",included:true}],
    preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}
  }});
  expect(explain.status).toBe(200);expect(explain.value.media.samples.length).toBeGreaterThan(0);
  expect(explain.value.profileSpeaker).toBe("Alex");expect(sources).toHaveLength(2);
  expect(calls).toHaveLength(0);
  await api(page,"reset");expect((await page.request.get(origin+existing.visual.imageUrl)).status()).not.toBe(200);
});
test("source outage continues both authorized AI options; source-only retry retains their completed artifacts",async({page})=>{
  await open(page);sourceFailure=true;
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/batch/review");
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();const review=await(await response).json();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  expect(calls).toHaveLength(2);expect(selections).toHaveLength(0);
  await expect(page.getByText("AI options use your description without meme inspiration.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:/Continue.*AI options/})).toHaveCount(0);
  const before=(await api(page,"generation/batch/status",{batchId:review.batchId})).value;
  sourceFailure=false;await page.getByRole("button",{name:"Retry image search",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
  const after=(await api(page,"generation/batch/status",{batchId:review.batchId})).value;
  expect(after.candidates.map((c:{operation:{image:{assetId:string}}})=>c.operation.image.assetId)).toEqual(before.candidates.map((c:{operation:{image:{assetId:string}}})=>c.operation.image.assetId));
  expect(calls).toHaveLength(2);expect(sources).toHaveLength(3);expect(selections).toHaveLength(1);expect(after.inspiration).toBeUndefined();
});
test("429 keeps source and first AI output; explicit retry inserts only the chosen AI artifact",async({page})=>{
  await open(page);failAt=2;
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/batch/review");
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();const review=await(await response).json();
  const retry=page.getByRole("button",{name:"Retry unfinished AI options",exact:true});
  await expect(retry).toBeVisible();await expect(retry).toBeDisabled();
  const before=(await api(page,"generation/batch/status",{batchId:review.batchId})).value;
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.providerNextAt=0;
  await expect(retry).toBeEnabled();await retry.click();await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
  const after=(await api(page,"generation/batch/status",{batchId:review.batchId})).value;
  expect(after.existing).toEqual(before.existing);expect(after.candidates[0].operation.image.assetId).toBe(before.candidates[0].operation.image.assetId);
  expect(calls).toHaveLength(3);expect(sources).toHaveLength(2);expect(calls[1]).toBe(calls[2]);
  await page.getByRole("button",{name:"Choose this option",exact:true}).last().click();
  await page.getByRole("button",{name:"Preview generated insertion",exact:true}).click();
  await page.getByRole("button",{name:"Insert generated visual locally",exact:true}).click();
  const state=(await api(page,"state")).value;
  expect(state.messages[0].generated.assetId).toBe(after.candidates[1].operation.image.assetId);expect(state.messages[0].visual).toBeUndefined();
});
test("edits cancel source preparation and room close retains a physical image lease until completion",async({page})=>{
  await open(page);holdSource=true;
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();await expect.poll(()=>sources.length).toBe(1);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Thanks for the teamwork, revised");
  holdSource=false;releaseSource?.();await expect(page.getByRole("button",{name:"Create 3 options",exact:true})).toBeEnabled();
  expect(calls).toHaveLength(0);expect(app.memeCounters.imageRequests).toBe(0);
  holdAt=1;await page.getByRole("button",{name:"Create 3 options",exact:true}).click();await expect.poll(()=>calls.length).toBe(1);
  await api(page,"session/close");expect(app.resources()).toMatchObject({paidBusy:true,nativeBusy:true});
  release?.();await expect.poll(()=>app.resources().paidBusy).toBe(false);
  expect(calls).toHaveLength(1);expect(app.resources().generatedBytes).toBe(0);
});
test("single GIF alternative and ten contexts remain available without a source asset fetch",async({page})=>{
  await open(page);await openCreationOptions(page);
  await page.getByLabel("Number of options",{exact:true}).selectOption("1");
  await page.getByRole("checkbox",{name:"Public meme inspiration (text only)",exact:true}).uncheck();
  const draft={...offlineDraft(),intent:"A cartoon thank-you from two detectives",output:"gif" as const};
  for(let i=0;i<10;i++)await api(page,"message",{speaker:"Alex",text:`Context ${i}`});
  const state=(await api(page,"state")).value;
  const review=await api(page,"generation/batch/review",{draft:{...draft,context:state.messages.map((m:{id:string;text:string})=>({label:m.id,text:m.text,included:true}))},draftRevision:0,count:1,referenceMode:"none"});
  expect(review.status).toBe(200);expect(review.value.existing).toBeUndefined();
  const {batchId,digest}=review.value;await api(page,"generation/batch/process",{batchId,digest,attempt:0,consent:true});
  await expect.poll(async()=>(await api(page,"generation/batch/status",{batchId})).value.status).toBe("ready");
  const status=(await api(page,"generation/batch/status",{batchId})).value;
  expect(status.candidates[0].operation.animation.method).toBe("generated-image-local-animation");
  expect(calls).toHaveLength(1);expect(sources).toHaveLength(0);
  const input=JSON.parse(JSON.parse(calls[0]).prompt.split("\n").at(-1));expect(input.context).toHaveLength(10);expect(input.intent).toBe(draft.intent);
});
for(const language of ["en","zh-CN"] as const)test(`semantic no-match is local to the source card and needs no second click in ${language}`,async({page})=>{
  selectionId=null;await open(page,language);
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  await expect(page.locator(".creation-advanced")).not.toHaveAttribute("open","");
  await expect(page.locator(".creation-summary")).toContainText(t("1 existing image with editable caption + 2 AI-generated options.","1 张现成图（配文可改）+ 2 个 AI 生成方案。"));
  await expect(page.locator(".creation-advanced").getByText(/sequential AI image request|次逐张 AI 图像请求/)).not.toBeVisible();
  await page.getByRole("button",{name:t("Create 3 options","创建 3 个方案"),exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText(t("2 of 3 ready","3 个方案中已有 2 个就绪"));
  await expect(page.locator(".existing-candidate")).toContainText(t("No matching image found. AI options will continue.","没有匹配图片，AI 方案将继续。"));
  await expect(page.getByRole("button",{name:t("Retry unfinished AI options","重试未完成的 AI 方案"),exact:true})).toHaveCount(0);
  expect(selections).toHaveLength(1);expect(calls).toHaveLength(2);expect(sources).toHaveLength(1);
  expect(calls.every(body=>!body.includes("publicTextInspiration"))).toBe(true);
  for(const width of [320,556]){
    await page.setViewportSize({width,height:950});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:resolve(".local","visual-context",`resilient-no-match-${language}-${width}-mock.png`)});
  }
  selectionId="135256802";
  await page.getByRole("button",{name:t("Retry image search","重试图片搜索"),exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText(t("3 of 3 ready","3 个方案中已有 3 个就绪"));
  expect(selections).toHaveLength(2);expect(calls).toHaveLength(2);
  await expect(page.getByText(t("AI options use your description without meme inspiration.","AI 方案继续使用你的描述，不含热图参考。"),{exact:true})).toBeVisible();
});
test("invalid selected references never select a fallback; unsafe image bytes never enter generated prompts",async({page})=>{
  selectionId="999999";await open(page);
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  expect(calls).toHaveLength(2);expect(app.memeCounters.imageRequests).toBe(0);
  expect(calls.every(body=>!body.includes("publicTextInspiration"))).toBe(true);
  selectionId="135256802";unsafeImage=true;
  await page.getByRole("button",{name:"Retry image search",exact:true}).click();
  await expect.poll(()=>app.memeCounters.imageRequests).toBe(1);
  await expect(page.locator(".existing-candidate").getByRole("alert")).toBeVisible();
  expect(calls).toHaveLength(2);expect(calls.every(body=>!body.includes("image_url"))).toBe(true);
});
test("selection authentication failure is fatal rather than a description-only image fallback",async({page})=>{
  selectionStatus=401;await open(page);
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".local-generation > .local-error")).toBeVisible();
  expect(calls).toHaveLength(0);expect(selections).toHaveLength(1);expect(app.memeCounters.imageRequests).toBe(0);
});
test("editing during the semantic call does not free its physical lease or dispatch source/AI images",async({page})=>{
  holdSelection=true;await open(page);
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect.poll(()=>selections.length).toBe(1);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("A revised expression");
  expect(app.resources().paidBusy).toBe(true);
  releaseSelection?.();await expect.poll(()=>app.resources().paidBusy).toBe(false);
  expect(calls).toHaveLength(0);expect(app.memeCounters.imageRequests).toBe(0);
});
test("semantic selection receives exact ten reviewed contexts and the outgoing report, never unselected rows",async({page})=>{
  await page.goto(origin+"/chat");
  for(let i=0;i<12;i++)await api(page,"message",{speaker:"Alex",text:`Fictional context ${i}`});
  const state=(await api(page,"state")).value;
  const draft={...offlineDraft(),intent:"这次没你们真不行。",context:state.messages.map((m:{id:string},i:number)=>({label:m.id,text:i<10?`Reviewed context ${i}`:"DO-NOT-SEND",included:i<10}))};
  const response=await api(page,"generation/batch/review",{draft,draftRevision:0,count:3,referenceMode:"popular-text"});
  expect(response.status).toBe(200);expect(selections).toHaveLength(1);
  const input=JSON.parse(JSON.parse(selections[0]).messages[1].content[0].text);
  expect(input.context).toHaveLength(10);expect(selections[0]).not.toContain("DO-NOT-SEND");
  expect(input.speakerContext).toMatchObject({role:"outgoing-speaker",profile:null});
  expect(input.preferences).toEqual(draft.preferences);expect(calls).toHaveLength(0);
});
