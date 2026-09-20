import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {openCreate} from "../expression-ui";
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,requests:string[],outside:number;
test.beforeEach(async()=>{
  requests=[];outside=0;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const forbidden=async()=>{outside++;throw new Error("Combined demo must not fetch or generate images");};
  app=await createLocalChatServer("OFFLINE",{clientRoot:resolve(root,"client"),interaction:"direct-personal",emojiExpressions:true,
    creationChoices:true,mixedCreation:true,contextualCreation:true,webCreation:true,webProvider:"serpapi",
    cooldownMs:0,catalogSource:"original-demo",memeTransport:forbidden,webSearchTransport:forbidden,generation:{transport:forbidden},
    transport:async(_url,init)=>{
      requests.push(String(init?.body));const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.messages[1].content[0].text);
      const output=payload.task==="explain"?{
        background:{source:null,context:null,frames:[]},
        observations:[{text:"Offline fixture observing the selected content.",frames:payload.frames.map((f:{id:string})=>f.id)}],
        commonUsage:["Possible meanings depend on the conversation."],
        contextualInterpretations:[{text:"An uncertain fixture interpretation.",context:payload.target.selectedContext?[payload.target.selectedContext]:payload.context.map((c:{label:string})=>c.label)}],
        uncertainties:["This is not a real model assessment."],safeResponseGuidance:["Ask neutrally."]
      }:{options:[
        {emojis:["👍"],label:"Acknowledge",reason:"Confirm receipt",caution:"Can seem brief",text:"Got it"},
        {emojis:["✅"],label:"Confirmed",reason:"Confirm completion",caution:"Only if finished",text:"Done"},
        {emojis:["🙏"],label:"Appreciation",reason:"Offer thanks",caution:"May also mean prayer or a request",text:"Thanks"}
      ]};
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]});
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
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
      body:JSON.stringify({revision:session.revision,...body})});
    return {status:response.status,value:await response.json()};
  },{path,body});
}
async function load(page:Page,language="en"){
  const response=page.waitForResponse(r=>r.url().endsWith("/local/demo"));
  await page.getByRole("button",{name:language==="en"?"Start demo":"开始演示",exact:true}).click();
  const result=await response;expect(result.status()).toBe(200);
  expect(result.request().postDataJSON().scenario).toBe("combined");
  await expect(page.getByTestId("chat-message")).toHaveCount(9);
  return result.json();
}
for(const language of ["en","zh-CN"])test(`${language}: one primary entry loads all media within ten messages without inference`,async({page})=>{
  await open(page,language);
  await expect(page.locator(".local-empty .local-primary")).toHaveCount(1);
  await expect(page.getByRole("button",{name:/emoji understanding demo|emoji 理解演示/})).toHaveCount(0);
  const room=await load(page,language);
  expect(room.messages.map((m:{demoMedia?:string})=>m.demoMedia??null)).toEqual([
    null,"user-reference","local-motion","custom-emoji","custom-emoji",null,"custom-emoji",null,null
  ]);
  expect(room.messages[5].text).toContain("👩🏽‍💻");expect(room.messages[7].text).toContain("🙏🙂");
  expect(room.messages[1].attachment.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(room.messages[2].attachment.dataUrl).toMatch(/^data:image\/gif;base64,/);
  expect(room.messages.filter((m:{attachment?:unknown})=>m.attachment)).toHaveLength(5);
  for(const image of await page.locator(".custom-emoji-icon").all()){
    expect(await image.evaluate(e=>({width:e.getBoundingClientRect().width,native:(e as HTMLImageElement).naturalWidth}))).toEqual({width:48,native:384});
  }
  await expect(page.locator(".custom-emoji-artwork > span, .custom-emoji-artwork > p")).toHaveCount(0);
  for(const artwork of await page.locator(".custom-emoji-artwork").all()){
    const box=await artwork.boundingBox();expect(box?.height).toBeLessThanOrEqual(90);
    expect(await artwork.innerText()).toBe(language==="en"?"Enlarge emoji (1)":"放大 emoji（1）");
    await expect(artwork.locator(":scope > button")).toHaveCount(1);
    const button=artwork.getByRole("button",{name:language==="en"?"Toggle custom emoji preview":"展开或收起自定义 emoji 预览",exact:true});
    const details=artwork.locator("details"),summary=details.locator("summary"),preview=details.locator(".custom-emoji-preview");
    expect(await button.getAttribute("aria-controls")).toBe(await details.getAttribute("id"));
    await expect(button).toHaveAttribute("aria-expanded","false");
    expect((await button.boundingBox())?.width).toBe(48);
    expect(await button.evaluate(el=>({border:getComputedStyle(el).borderWidth,background:getComputedStyle(el).backgroundColor})))
      .toEqual({border:"0px",background:"rgba(0, 0, 0, 0)"});
    await button.locator("img").click();
    await expect(preview).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded","true");
    await expect(preview).toHaveAttribute("src",(await button.locator("img").getAttribute("src"))!);
    expect((await preview.boundingBox())?.width).toBe(256);
    await button.click();await expect(preview).toHaveCount(0);
    await expect(button).toBeFocused();
    await summary.focus();await page.keyboard.press("Enter");await expect(preview).toBeVisible();await expect(summary).toBeFocused();
    expect(await summary.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.keyboard.press("Space");await expect(preview).toHaveCount(0);await expect(summary).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded","false");
    await summary.click();await expect(preview).toBeVisible();await summary.click();await expect(preview).toHaveCount(0);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  }
  const unicode=page.getByTestId("chat-message").nth(5).locator(".emoji-inspector");
  await unicode.locator("summary").click();await expect(unicode.locator(".emoji-enlarged")).toHaveText("👩🏽‍💻");
  await expect(unicode.locator("summary")).toHaveText(language==="en"?"Enlarge emoji (1)":"放大 emoji（1）");
  await expect(unicode.locator(".inline-emoji-scope")).toContainText(language==="en"?"not only the previewed symbol":"而非仅当前预览的符号");
  await expect(unicode.locator(".emoji-possible-uses,.emoji-identity-caution")).toHaveCount(0);
  await unicode.locator("summary").click();
  const styles=await page.locator(".emoji-enlargement:not(.visual-enlargement) > summary").evaluateAll(elements=>elements.map(el=>{
    const s=getComputedStyle(el);return {font:s.font,padding:s.padding,lineHeight:s.lineHeight,marker:s.listStyleType,display:s.display,margin:s.margin};
  }));
  expect(styles).toHaveLength(5);for(const style of styles)expect(style).toEqual(styles[0]);
  expect(styles[0]).toMatchObject({marker:"disclosure-closed",display:"list-item"});
  const ids=await page.locator(".emoji-enlargement").evaluateAll(elements=>elements.map(el=>el.id));
  expect(new Set(ids).size).toBe(ids.length);await expect(page.locator("summary button,button button")).toHaveCount(0);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1100});
    if(width<1100)await page.getByRole("button",{name:language==="en"?"Hide AI panel":"收起 AI 面板",exact:true}).click();
    const panels=[];
    for(const details of await page.locator(".emoji-enlargement:not(.visual-enlargement)").all()){
      const summary=details.locator("summary");
      await summary.focus();await page.keyboard.press("Space");
      await expect(details.locator(".emoji-enlargement-panel")).toBeVisible();
      expect(await summary.evaluate(el=>getComputedStyle(el).listStyleType)).toBe("disclosure-open");
      const panel=details.locator(".emoji-enlargement-panel");
      panels.push(await panel.evaluate(el=>{const s=getComputedStyle(el);return {padding:s.padding,border:s.border,background:s.background,borderRadius:s.borderRadius};}));
      const rect=await panel.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(width);
      const choices=details.locator(".emoji-inspector-choices button");
      if(await choices.count()===2){
        await choices.nth(1).click();await expect(details.locator(".emoji-enlarged")).toHaveText("🙂");
        await choices.first().click();await expect(details.locator(".emoji-enlarged")).toHaveText("🙏");
      }
      await summary.focus();await page.keyboard.press("Enter");
      await expect(panel).toHaveCount(0);await expect(summary).toBeFocused();
    }
    for(const panel of panels)expect(panel).toEqual(panels[0]);
    const selected=page.getByTestId("chat-message").nth(4);
    await selected.getByRole("button",{name:language==="en"?"Message actions":"消息操作",exact:true}).click();
    await page.getByRole("menuitem",{name:language==="en"?"Media information":"素材信息",exact:true}).click();
    await expect(page.getByRole("dialog")).toContainText(language==="en"?"locally authored":"本地绘制");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({width:1440,height:1100});
  await page.getByRole("button",{name:language==="en"?"Open AI panel":"打开 AI 面板",exact:true}).click();
  await expect(page.getByTestId("chat-message").nth(8).getByRole("button",{name:language==="en"?"Explain":"解释一下",exact:true})).toHaveCount(0);
  await page.locator(".local-tabs").getByRole("button",{name:language==="en"?"Express":"帮我表达",exact:true}).click();
  await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
  await page.getByRole("radio",{name:language==="en"?"Images / GIFs":"图片 / GIF",exact:true}).check();
  expect(requests).toHaveLength(0);expect(room.providerRequests).toBe(0);expect(outside).toBe(0);
  await expect(page.getByRole("button",{name:language==="en"?"Load demo":"载入演示",exact:true})).toBeDisabled();
});
for(const language of ["en","zh-CN"])test(`${language}: mixed ordering preserves film, GIF, all custom pixels and exact Unicode Explain contracts`,async({page})=>{
  await open(page,language);const room=await load(page,language),proofs=[];
  for(const index of [1,2,3,4,5,6,7]){
    const reviewed=page.waitForResponse(r=>r.url().endsWith("/local/review")),processed=page.waitForResponse(r=>r.url().endsWith("/local/process"));
    await page.getByTestId("chat-message").nth(index).getByRole("button",{name:language==="en"?"Explain":"解释一下",exact:true}).click();
    const reviewResponse=await reviewed,review=await reviewResponse.json();expect(reviewResponse.status(),review.code).toBe(200);
    const result=await processed;expect(result.status()).toBe(200);
    const body=JSON.parse(requests.at(-1)!),payload=JSON.parse(body.messages[1].content[0].text),schema=body.response_format.json_schema.schema.properties;
    expect(payload.context).toEqual(room.messages.map((m:{speaker:string;text:string},i:number)=>({label:`c${i}`,text:`${m.speaker}: ${m.text}`})));
    expect(review.processing.inputTokens).toBeLessThanOrEqual(8500);
    const custom=[3,4,6].includes(index),unicode=[5,7].includes(index);
    if(custom){
      expect(payload.target).toEqual({kind:"visual",source:"original-custom-emoji",selectedContext:`c${index}`});
      expect(schema.background.properties.source.enum).toEqual([null]);expect(schema.background.properties.frames.maxItems).toBe(0);
      expect((await result.json()).result.explanation.contextualInterpretations[0].context).toEqual([room.messages[index].id]);
    }else if(unicode){
      expect(payload.target).toEqual({kind:"emoji",emoji:index===5?"👩🏽‍💻":"🙏 🙂"});
      expect(payload.frames).toEqual([]);expect(body.messages[1].content).toHaveLength(1);
      expect(schema.background.properties.source.enum).toEqual([null]);expect(schema.observations.items.properties.frames.maxItems).toBe(0);
    }else{
      expect(payload.target).toEqual({kind:"visual"});
      expect(schema.background.properties.source.enum).toBeUndefined();
    }
    if(!unicode){
      expect(review.media.samples).toHaveLength(index===2?2:1);
      for(const [i,sample] of review.media.samples.entries()){
        expect(sample.assetId).toBe(room.messages[index].id);
        expect(body.messages[1].content[i+1].image_url.url).toBe(sample.dataUrl);
      }
      if(index!==2){
        const original=Buffer.from(room.messages[index].attachment.dataUrl.split(",")[1],"base64");
        const sent=Buffer.from(body.messages[1].content[1].image_url.url.split(",")[1],"base64");
        expect(await sharp(sent).ensureAlpha().raw().toBuffer()).toEqual(await sharp(original).ensureAlpha().raw().toBuffer());
      }
    }
    proofs.push({index,selectedId:room.messages[index].id,target:payload.target,contextCount:payload.context.length,
      sampleOwners:review.media.samples.map((s:{assetId:string})=>s.assetId),inputTokens:review.processing.inputTokens,request:body});
  }
  expect(requests).toHaveLength(7);
  const directory=resolve(".local","visual-context","demo-polish-offline");await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,`explain-bindings-${language}.json`),JSON.stringify({paidCalls:0,fixtureProvider:true,proofs},null,2));
});
test("selected film carries into both Express modes; emoji insertion preserves draft and attachment without sending",async({page})=>{
  await open(page);const room=await load(page);
  await page.getByTestId("chat-message").nth(1).getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".explanation-panel")).toBeVisible();expect(requests).toHaveLength(1);
  await openCreate(page);
  await expect(page.getByLabel("Visual context (optional override)",{exact:true})).toHaveValue(room.messages[1].id);
  await expect(page.locator(".reply-target-cue")).toContainText("Maya");
  await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
  await expect(page.getByLabel("Reply to message",{exact:true})).toHaveValue(room.messages[1].id);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Acknowledge the idea cautiously");
  await page.getByLabel("Message",{exact:true}).fill("Keep my draft");
  const bytes=await readFile(resolve("assets","emoji-demo","icon-01.png"));
  await page.locator(".local-composer input[type=file]").setInputFiles({name:"owned.png",mimeType:"image/png",buffer:bytes});
  await expect(page.locator(".composer-attachment img")).toBeVisible();expect(requests).toHaveLength(1);
  await page.getByRole("button",{name:"Suggest emoji",exact:true}).click();
  await expect(page.locator(".emoji-options article")).toHaveCount(3);
  const body=JSON.parse(requests[1]),input=JSON.parse(body.messages[1].content[0].text);
  expect(body.messages[1].content).toHaveLength(1);  expect(input.replyTo.text).toBe("Maya: One portal to rule them all?");
  expect(input.context).toHaveLength(9);
  await page.getByRole("button",{name:"Choose option 1",exact:true}).click();
  await page.getByRole("button",{name:"Insert into composer",exact:true}).click();
  await expect(page.getByLabel("Message",{exact:true})).toHaveValue("Keep my draft 👍");
  await expect(page.locator(".composer-attachment img")).toBeVisible();
  expect((await api(page,"state")).value.messages).toHaveLength(9);expect(requests).toHaveLength(2);
});
test("duplicate and occupied loads preserve history; reset and reload release and rebind all media",async({page,browser})=>{
  await open(page);const first=await load(page);
  const duplicate=await api(page,"demo",{language:"en",scenario:"combined"});expect(duplicate.status).toBe(400);
  expect((await api(page,"state")).value.messages).toEqual(first.messages);
  const other=await browser.newContext();
  try{
    const p=await other.newPage();await open(p);await api(p,"message",{speaker:"Alex",text:"Keep this room"});
    expect((await api(p,"demo",{language:"en",scenario:"combined"})).status).toBe(400);
    const reset=(await api(page,"reset")).value;expect(reset.mediaBytes).toBe(0);expect(reset.messages).toHaveLength(0);
    expect((await api(page,"demo",{language:"en",scenario:"combined"})).status).toBe(200);
    const reloaded=(await api(page,"state")).value;
    expect(reloaded.messages).toHaveLength(9);expect(reloaded.mediaBytes).toBe(first.mediaBytes);
    expect(reloaded.messages.every((m:{id:string})=>!first.messages.some((old:{id:string})=>old.id===m.id))).toBe(true);
    const preserved=(await api(p,"state")).value.messages;
    expect(preserved).toHaveLength(1);expect(preserved[0].text).toBe("Keep this room");
    expect((await api(p,"demo",{language:"en",scenario:"unknown"})).status).toBe(400);expect(requests).toHaveLength(0);
  }finally{await other.close();}
});
test("cancelling combined native staging leaves zero committed messages or media",async({page})=>{
  await open(page);
  const pending=api(page,"demo",{language:"en",scenario:"combined"});
  await expect.poll(()=>app.resources().nativeBusy,{intervals:[5]}).toBe(true);
  const during=(await api(page,"state")).value;expect(during.messages).toHaveLength(0);expect(during.mediaBytes).toBe(0);
  await api(page,"cancel");expect((await pending).status).toBe(400);
  const after=(await api(page,"state")).value;expect(after.messages).toHaveLength(0);expect(after.mediaBytes).toBe(0);
  expect(requests).toHaveLength(0);
});
