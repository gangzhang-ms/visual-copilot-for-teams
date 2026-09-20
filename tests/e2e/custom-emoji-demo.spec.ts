import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {readFile} from "node:fs/promises";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
let app:Awaited<ReturnType<typeof Factory>>,origin:string,requests:string[],outside:number,invalidBackground:boolean;
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
test.beforeEach(async()=>{
  requests=[];outside=0;invalidBackground=false;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const forbidden=async()=>{outside++;throw new Error("No external asset or generation allowed");};
  app=await createLocalChatServer("OFFLINE",{clientRoot:resolve(root,"client"),interaction:"direct-personal",emojiExpressions:true,
    creationChoices:true,cooldownMs:0,catalogSource:"original-demo",memeTransport:forbidden,webSearchTransport:forbidden,generation:{transport:forbidden},
    transport:async(_url,init)=>{
      requests.push(String(init?.body));const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.messages[1].content[0].text);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        background:{source:null,context:null,frames:invalidBackground?["f0"]:[]},observations:[{text:"An original small image with mixed visual cues.",frames:payload.frames.map((f:{id:string})=>f.id)}],
        commonUsage:["Could express mixed feelings."],contextualInterpretations:[{text:"It may soften the reply, but intention is uncertain.",context:payload.context.map((c:{label:string})=>c.label)}],
        uncertainties:["Custom images have no universal dictionary meaning."],safeResponseGuidance:["Ask whether they need a break."]
      })}}]});
    }});
  origin=await app.start(0);
});
test.afterEach(async()=>{await app.close();expect(outside).toBe(0);});
async function open(page:Page,language="en"){
  await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  if(language!=="en")await page.getByLabel("Language / 语言").selectOption(language);
}
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const s=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const r=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":s.csrf},body:JSON.stringify({revision:s.revision,...body})});
    return {status:r.status,value:await r.json()};
  },{path,body});
}
async function legacyEmojiDemo(page:Page,language="en"){
  expect((await api(page,"demo",{language,scenario:"emoji"})).status).toBe(200);
  await page.reload();
  await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  if(language!=="en")await page.getByLabel("Language / 语言").selectOption(language);
}
for(const language of ["en","zh-CN"])test(`coherent ${language} demo loads atomically with compact images, Unicode and no AI`,async({page})=>{
  await open(page,language);
  await legacyEmojiDemo(page,language);
  await expect(page.getByTestId("chat-message")).toHaveCount(7);
  await expect(page.locator(".custom-emoji-icon")).toHaveCount(3);
  const state=(await api(page,"state")).value;
  expect(state.messages[3].text).toContain("👩🏽‍💻");expect(state.messages[6].text).toContain("🙏🙂");
  expect(state.messages.filter((m:{demoMedia:string})=>m.demoMedia==="user-reference")).toHaveLength(0);
  expect(state.mediaBytes).toBeGreaterThan(95_000);expect(state.mediaBytes).toBeLessThan(512*1024);
  for(const image of await page.locator(".custom-emoji-icon").all()){
    expect(await image.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,natural:(e as HTMLImageElement).naturalWidth})))
      .toEqual({width:48,height:48,natural:384});
  }
  const trigger=page.getByRole("button",{name:language==="en"?"Toggle custom emoji preview":"展开或收起自定义 emoji 预览",exact:true}).first();
  await trigger.click();const preview=page.locator(".custom-emoji-preview");
  await expect(preview).toBeVisible();expect((await preview.boundingBox())?.width).toBe(256);
  await trigger.click();await expect(preview).toHaveCount(0);await expect(trigger).toBeFocused();
  const selected=page.getByTestId("chat-message").nth(1);
  await selected.getByRole("button",{name:language==="en"?"Message actions":"消息操作",exact:true}).click();
  await page.getByRole("menuitem",{name:language==="en"?"Media information":"素材信息",exact:true}).click();
  const information=page.getByRole("dialog",{name:language==="en"?"Media information":"素材信息",exact:true});
  await expect(information).toContainText(language==="en"?"locally authored":"本地绘制");
  await page.keyboard.press("Escape");
  expect(requests).toHaveLength(0);
  expect((await api(page,"demo",{language,scenario:"emoji"})).status).toBe(400);
  expect((await api(page,"state")).value.messages).toHaveLength(7);
});
test("custom-image Explain transmits actual owned pixels while Unicode remains text-only",async({page})=>{
  await open(page);await legacyEmojiDemo(page);
  await expect(page.getByTestId("chat-message")).toHaveCount(7);
  const state=(await api(page,"state")).value;
  const reviewResponse=page.waitForResponse(r=>r.url().endsWith("/local/review"));
  await page.getByTestId("chat-message").filter({hasText:"I can take the next one."}).getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".explanation-panel")).toBeVisible();
  const review=await(await reviewResponse).json(),body=JSON.parse(requests[0]),payload=JSON.parse(body.messages[1].content[0].text);
  expect(payload.target).toEqual({kind:"visual",source:"original-custom-emoji",selectedContext:"c1"});expect(body.response_format.json_schema.name).toBe("visual_explanation_v2");
  const schema=body.response_format.json_schema.schema.properties;
  expect(schema.background.properties.source.enum).toEqual([null]);expect(schema.background.properties.frames.maxItems).toBe(0);
  expect(schema.observations.items.properties.frames.items.enum).toEqual(["f0"]);
  expect(payload.context).toHaveLength(7);expect(payload.frames).toHaveLength(1);
  expect(body.messages[1].content[1].image_url.url).toBe(review.media.samples[0].dataUrl);
  const transmitted=Buffer.from(body.messages[1].content[1].image_url.url.split(",")[1],"base64");
  expect(await sharp(transmitted).metadata()).toMatchObject({width:384,height:384,format:"png"});
  const original=await readFile(resolve("assets","emoji-demo","icon-01.png"));
  expect(await sharp(transmitted).ensureAlpha().raw().toBuffer()).toEqual(await sharp(original).ensureAlpha().raw().toBuffer());
  expect(Buffer.from(state.messages[1].attachment.dataUrl.split(",")[1],"base64").equals(original)).toBe(true);
  expect(review.media.samples[0].assetId).toBe(state.messages[1].id);
  expect(JSON.stringify(payload)).not.toMatch(/icon-01|strained|polite-smile|brain.loading/i);
  await page.getByTestId("chat-message").filter({hasText:"Thanks for making room."}).getByRole("button",{name:"Explain",exact:true}).click();
  await expect.poll(()=>requests.length).toBe(2);
  expect(JSON.parse(requests[1]).messages[1].content).toHaveLength(1);
  expect(JSON.parse(JSON.parse(requests[1]).messages[1].content[0].text).target).toEqual({kind:"emoji",emoji:"🙏 🙂"});
});
test("demo never replaces an existing room; reset releases media and reload has fresh ownership",async({page,browser})=>{
  await open(page);await api(page,"demo",{language:"en",scenario:"emoji"});
  const first=(await api(page,"state")).value,other=await browser.newContext();
  try{
    const p=await other.newPage();await open(p);await api(p,"message",{speaker:"Alex",text:"Keep this room"});
    expect((await api(p,"demo",{language:"en",scenario:"emoji"})).status).toBe(400);
    expect((await api(p,"state")).value.messages[0].text).toBe("Keep this room");
    const reset=(await api(page,"reset")).value;expect(reset.mediaBytes).toBe(0);expect(reset.messages).toHaveLength(0);
    await api(page,"demo",{language:"en",scenario:"emoji"});const second=(await api(page,"state")).value;
    expect(second.messages.every((m:{id:string})=>!first.messages.some((old:{id:string})=>old.id===m.id))).toBe(true);
    expect((await api(p,"state")).value.messages).toHaveLength(1);
    await api(page,"reset");await api(page,"demo",{language:"en"});
    const film=(await api(page,"state")).value;expect(film.messages).toHaveLength(5);expect(film.messages[1].demoMedia).toBe("user-reference");
    expect(requests).toHaveLength(0);
  }finally{await other.close();}
});
test("cancelling an in-progress native demo load cannot commit a partial conversation",async({page})=>{
  await open(page);
  const result=await page.evaluate(async()=>{
    const s=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const headers={"Content-Type":"application/json","X-Local-CSRF":s.csrf};
    const pending=fetch("/local/demo",{method:"POST",headers,body:JSON.stringify({revision:s.revision,language:"en",scenario:"emoji"})});
    let busy=false;
    for(let i=0;i<100;i++){
      const state=await(await fetch("/local/state",{method:"POST",headers,body:"{}"})).json();
      if(state.generation.reason==="generation-busy"){
        if(state.messages.length)throw new Error("Partial commit");
        busy=true;break;
      }
      await new Promise(done=>setTimeout(done,5));
    }
    await fetch("/local/cancel",{method:"POST",headers,body:"{}"});
    const response=await pending;
    const state=await(await fetch("/local/state",{method:"POST",headers,body:"{}"})).json();
    return {busy,status:response.status,state};
  });
  expect(result.busy).toBe(true);expect(result.status).toBe(400);
  expect(result.state.messages).toHaveLength(0);expect(result.state.mediaBytes).toBe(0);expect(requests).toHaveLength(0);
});
test("custom presentation cannot be forged on arbitrary uploaded images",async({page})=>{
  await open(page);const bytes=await readFile(resolve("assets","emoji-demo","icon-01.png"));
  const result=await api(page,"message",{speaker:"Maya",text:"Owned image",demoMedia:"custom-emoji",
    attachment:{base64:bytes.toString("base64"),mime:"image/png",category:"sticker"}});
  expect(result.status).toBe(200);expect(result.value.messages[0].demoMedia).toBeUndefined();
  await page.reload();await expect(page.locator(".custom-emoji-icon")).toHaveCount(0);
});
test("captured inconsistent model provenance still fails visibly without stripping its frame or retrying",async({page})=>{
  invalidBackground=true;await open(page);
  await legacyEmojiDemo(page);await expect(page.getByTestId("chat-message")).toHaveCount(7);
  const response=page.waitForResponse(r=>r.url().endsWith("/local/process"));
  await page.getByTestId("chat-message").filter({hasText:"I can take the next one."}).getByRole("button",{name:"Explain",exact:true}).click();
  const result=await response;expect(result.status()).toBe(400);expect((await result.json()).code).toBe("model-output-invalid-schema");
  await expect(page.getByRole("alert")).toBeVisible();await expect(page.locator(".explanation-panel")).toHaveCount(0);expect(requests).toHaveLength(1);
});
