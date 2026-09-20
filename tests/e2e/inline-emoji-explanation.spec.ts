import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(name:string)=>pathToFileURL(resolve(root,"server",name)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,requests:string[],failure:boolean,hold:boolean,release:(()=>void)|undefined,outside:number,identify:boolean;
test.beforeEach(async()=>{
  requests=[];failure=false;hold=false;release=undefined;outside=0;identify=false;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const forbidden=async()=>{outside++;throw new Error("Inline Explain cannot search, generate or download");};
  app=await createLocalChatServer("OFFLINE-INLINE-EXPLAIN",{interaction:"direct-personal",clientRoot:resolve(root,"client"),
    emojiExpressions:true,creationChoices:true,contextualCreation:true,cooldownMs:0,catalogSource:"original-demo",
    memeTransport:forbidden,webSearchTransport:forbidden,generation:{transport:forbidden},
    transport:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.messages[1].content[0].text);
      requests.push(String(init?.body));const index=requests.length;
      if(hold)await new Promise<void>(done=>{const timer=setTimeout(done,10_000);release=()=>{clearTimeout(timer);done();};});
      if(failure)return new Response("PRIVATE_PROVIDER_FAILURE",{status:503});
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        background:identify&&payload.target.kind==="visual"&&!payload.target.source
          ?{source:"Offline fixture work",context:"An authored source-background fixture.",frames:payload.frames.map((f:{id:string})=>f.id)}
          :{source:null,context:null,frames:[]},
        observations:[{text:`Offline visible fixture ${index}.`,frames:payload.frames.map((f:{id:string})=>f.id)}],
        commonUsage:["An offline fixture, not a new live interpretation."],
        contextualInterpretations:[{text:`Offline contextual fixture ${index} for ${payload.target.selectedContext??"Unicode"}.`,
          context:payload.target.selectedContext?[payload.target.selectedContext]:payload.context.map((c:{label:string})=>c.label)}],
        uncertainties:["This does not establish sender intent."],safeResponseGuidance:["Ask neutrally."]
      })}}]});
    }});
  origin=await app.start(0);
});
test.afterEach(async()=>{release?.();await app.close();expect(outside).toBe(0);});
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
      body:JSON.stringify({revision:session.revision,...body})});
    return {status:response.status,value:await response.json()};
  },{path,body});
}
async function demo(page:Page,language="en"){
  await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  if(language!=="en")await page.getByLabel("Language / 语言").selectOption(language);
  await page.getByRole("button",{name:language==="en"?"Start demo":"开始演示",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(9);
  return (await api(page,"state")).value;
}
for(const language of ["en","zh-CN"])test(`${language}: all custom inline actions own one existing Explain request and reuse its actual validated result`,async({page})=>{
  const room=await demo(page,language),proofs=[];
  for(const [index,target] of [3,4,6].entries()){
    const row=page.getByTestId("chat-message").nth(target),summary=row.locator(".custom-emoji-artwork summary");
    await summary.click();
    const inline=row.locator(".inline-emoji-explanation"),button=inline.locator("button");
    await expect(inline).toContainText(language==="en"?"Use AI to interpret this message":"使用 AI 结合对话");
    expect(requests).toHaveLength(index);await expect(inline.locator(".inline-emoji-result")).toHaveCount(0);
    const reviewWait=page.waitForResponse(r=>r.url().endsWith("/local/review")),processWait=page.waitForResponse(r=>r.url().endsWith("/local/process"));
    await expect(button).toBeEnabled();await button.focus();await page.keyboard.press("Enter");
    const review=await(await reviewWait).json(),response=await processWait;
    expect(response.status()).toBe(200);const result=(await response.json()).result.explanation;
    await expect(inline.locator(".inline-explanation-details")).toContainText(result.observations[0].text);
    await expect(inline.locator(".inline-emoji-meaning")).toContainText(result.contextualInterpretations[0].text);
    await expect(inline.locator(".inline-explanation-details")).toContainText(result.uncertainties[0]);
    await expect(button).toBeFocused();
    const body=JSON.parse(requests[index]),payload=JSON.parse(body.messages[1].content[0].text);
    expect(payload.target).toEqual({kind:"visual",source:"original-custom-emoji",selectedContext:`c${target}`});
    expect(payload.context).toHaveLength(9);
    expect(review.media.samples[0].assetId).toBe(room.messages[target].id);
    expect(body.messages[1].content[1].image_url.url).toBe(review.media.samples[0].dataUrl);
    expect(await sharp(Buffer.from(body.messages[1].content[1].image_url.url.split(",")[1],"base64")).ensureAlpha().raw().toBuffer())
      .toEqual(await sharp(Buffer.from(room.messages[target].attachment.dataUrl.split(",")[1],"base64")).ensureAlpha().raw().toBuffer());
    expect(result.contextualInterpretations[0].context).toEqual([room.messages[target].id]);
    await button.click();await expect(page.locator(".explanation-panel .explanation-brief")).toContainText(result.contextualInterpretations[0].text);
    await row.getByRole("button",{name:language==="en"?"Explain":"解释一下",exact:true}).click();
    expect(requests).toHaveLength(index+1);
    await summary.click();await expect(inline).toHaveCount(0);await summary.click();
    await expect(inline.locator(".inline-emoji-meaning")).toContainText(result.contextualInterpretations[0].text);
    expect(requests).toHaveLength(index+1);
    if(index>0)await expect(page.getByTestId("chat-message").nth(3).locator(".inline-emoji-result")).toHaveCount(0);
    proofs.push({target,selectedId:room.messages[target].id,request:body,result});
  }
  const dir=resolve(".local","visual-context","emoji-inline-offline");await mkdir(dir,{recursive:true});
  await writeFile(resolve(dir,`validated-${language}.json`),JSON.stringify({fixtureOnly:true,paidCalls:0,proofs},null,2));
  await page.getByTestId("chat-message").nth(6).screenshot({path:resolve(dir,`inline-${language}-fixture.png`)});
  expect((await api(page,"state")).value.messages).toHaveLength(9);
});
test("top-level Explain populates a closed preview; changing context or saved profile invalidates inline reuse",async({page})=>{
  await demo(page);const row=page.getByTestId("chat-message").nth(4);
  await row.getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".explanation-panel")).toBeVisible();expect(requests).toHaveLength(1);
  await row.locator(".custom-emoji-artwork summary").click();
  const inline=row.locator(".inline-emoji-explanation");
  await expect(inline.locator(".inline-emoji-meaning")).toContainText("fixture 1");expect(requests).toHaveLength(1);
  await page.getByLabel("Message",{exact:true}).fill("The deployment status changed.");
  await page.getByRole("button",{name:"Add locally",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(10);
  await expect(inline.locator(".inline-emoji-result")).toHaveCount(0);
  await inline.getByRole("button",{name:"Explain with AI",exact:true}).click();
  await expect(inline.locator(".inline-emoji-meaning")).toContainText("fixture 2");
  expect(JSON.parse(JSON.parse(requests[1]).messages[1].content[0].text).context).toHaveLength(10);
  await page.locator(".speaker-profile summary").click();
  await page.getByLabel("Speaker tone",{exact:true}).fill("Please keep this calm");
  await expect(inline.locator(".inline-emoji-result")).toHaveCount(0);
  await page.getByRole("button",{name:"Save speaker profile",exact:true}).click();
  await expect(page.getByRole("button",{name:"Save speaker profile",exact:true})).toBeDisabled();
  await inline.getByRole("button",{name:"Explain with AI",exact:true}).click();
  await expect(inline.locator(".inline-emoji-meaning")).toContainText("fixture 3");
  expect(JSON.parse(JSON.parse(requests[2]).messages[1].content[0].text).speakerContext.profile.tone).toBe("Please keep this calm");
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await expect(inline.locator(".inline-emoji-result")).toHaveCount(0);expect(requests).toHaveLength(3);
});
test("failure stays inline without a fabricated result or retry; only explicit retry dispatches",async({page})=>{
  failure=true;await demo(page);
  const row=page.getByTestId("chat-message").nth(3);await row.locator(".custom-emoji-artwork summary").click();
  const inline=row.locator(".inline-emoji-explanation");await inline.getByRole("button",{name:"Explain with AI",exact:true}).click();
  await expect(inline.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(inline.locator(".inline-emoji-result")).toHaveCount(0);
  await expect(inline).not.toContainText("PRIVATE_PROVIDER_FAILURE");expect(requests).toHaveLength(1);
  await row.locator("summary").click();await row.locator("summary").click();expect(requests).toHaveLength(1);
  failure=false;await inline.getByRole("button",{name:"Retry AI explanation",exact:true}).click();
  await expect(inline.locator(".inline-emoji-meaning")).toContainText("fixture 2");expect(requests).toHaveLength(2);
});
test("pending duplicate activation and cancellation cannot leak late results under another emoji",async({page})=>{
  await demo(page);hold=true;
  const first=page.getByTestId("chat-message").nth(3),second=page.getByTestId("chat-message").nth(4);
  await first.locator(".custom-emoji-artwork summary").click();await second.locator(".custom-emoji-artwork summary").click();
  const inline=first.locator(".inline-emoji-explanation");
  const explain=inline.getByRole("button",{name:"Explain with AI",exact:true});
  await expect(explain).toBeEnabled();await explain.evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
  await expect.poll(()=>requests.length).toBe(1);await expect(inline).toHaveAttribute("aria-busy","true");
  await expect(second.locator(".inline-emoji-explanation button")).toBeDisabled();
  await expect(inline.getByRole("status")).toContainText("Explaining");
  await inline.getByRole("button",{name:"Cancel explanation",exact:true}).click();
  await expect(inline.getByRole("status")).toContainText("cancelled");
  release!();hold=false;await expect.poll(()=>app.resources().paidBusy).toBe(false);
  await second.locator(".inline-emoji-explanation").getByRole("button",{name:"Explain with AI",exact:true}).click();
  await expect(second.locator(".inline-emoji-meaning")).toContainText("fixture 2 for c4");
  await expect(first.locator(".inline-emoji-result")).toHaveCount(0);expect(requests).toHaveLength(2);
});
test("language invalidation and room clear discard a pending explanation rather than show stale content",async({page})=>{
  await demo(page);hold=true;
  const row=page.getByTestId("chat-message").nth(6);await row.locator(".custom-emoji-artwork summary").click();
  await row.getByRole("button",{name:"Explain with AI",exact:true}).click();await expect.poll(()=>requests.length).toBe(1);
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  release!();hold=false;await expect.poll(()=>app.resources().paidBusy).toBe(false);
  await expect(row.locator(".inline-emoji-result")).toHaveCount(0);
  await page.getByRole("button",{name:"清空对话",exact:true}).first().click();
  await expect(page.getByTestId("chat-message")).toHaveCount(0);
  await expect(page.locator(".inline-emoji-explanation")).toHaveCount(0);expect(requests).toHaveLength(1);
});
test("narrow inline requests keep focus in chat; Unicode uses the same presenter without image frames",async({page})=>{
  await demo(page);await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"Hide AI panel",exact:true}).click();
  for(const target of [3,5,7]){
    const row=page.getByTestId("chat-message").nth(target);await row.locator(".emoji-enlargement summary").click();
    const inline=row.locator(".inline-emoji-explanation"),button=inline.locator("button");
    await expect(button).toBeEnabled();await button.focus();await page.keyboard.press("Enter");
    await expect(inline.locator(".inline-emoji-result")).toBeVisible();await expect(button).toBeFocused();
    await expect(page.getByRole("button",{name:"Open AI panel",exact:true})).toHaveAttribute("aria-expanded","false");
    const rect=await inline.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(390);
    if(target!==3){
      const body=JSON.parse(requests.at(-1)!),payload=JSON.parse(body.messages[1].content[0].text);
      expect(body.messages[1].content).toHaveLength(1);expect(payload.frames).toEqual([]);
      expect(payload.target).toEqual({kind:"emoji",emoji:target===5?"👩🏽‍💻":"🙏 🙂"});
      await expect(row.locator(".inline-emoji-scope")).toContainText("not only the previewed symbol");
    }
    await row.getByRole("button",{name:"Message actions",exact:true}).click();
    await page.keyboard.press("Escape");
  }
  expect(requests).toHaveLength(3);
});
for(const language of ["en","zh-CN"])test(`${language}: every emoji format has identical initial/pending/error/ready controls and whole-message scope`,async({page})=>{
  await demo(page,language);
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const rows=[3,4,5,6,7].map(index=>page.getByTestId("chat-message").nth(index));
  const initial=[];
  for(const row of rows){
    await row.locator(".emoji-enlargement > summary").click();
    const region=row.locator(".inline-emoji-explanation");
    await expect(region.getByRole("button",{name:t("Explain with AI","AI解释"),exact:true})).toBeVisible();
    initial.push(await region.innerText());
    await expect(row.locator(".emoji-possible-uses,.emoji-identity-caution,.inline-emoji-result")).toHaveCount(0);
    await expect(region.locator(".inline-emoji-scope")).toHaveText(t("Scope: this message's emoji, not only the previewed symbol.","范围：这条消息中的 emoji，而非仅当前预览的符号。"));
  }
  for(const text of initial)expect(text).toBe(initial[0]);expect(requests).toHaveLength(0);
  const proofs=[];
  for(const [index,row] of rows.entries()){
    const region=row.locator(".inline-emoji-explanation");
    failure=true;hold=true;
    await region.getByRole("button",{name:t("Explain with AI","AI解释"),exact:true}).click();
    await expect.poll(()=>requests.length).toBe(index*2+1);
    await expect(region).toHaveAttribute("aria-busy","true");
    await expect(region.getByRole("status")).toHaveText(t("Explaining this message…","正在解释这条消息……"));
    await expect(region.getByRole("button",{name:t("Cancel explanation","取消解释"),exact:true})).toBeEnabled();
    release!();hold=false;
    await expect(region.getByRole("alert")).toContainText(t("temporarily unavailable","服务暂不可用"));
    await expect(region.locator(".inline-emoji-result")).toHaveCount(0);expect(requests).toHaveLength(index*2+1);
    failure=false;
    await region.getByRole("button",{name:t("Retry AI explanation","重试 AI 解释"),exact:true}).click();
    await expect(region.locator(".inline-emoji-result")).toBeVisible();
    await expect(region.locator(".inline-explanation-details")).toContainText("An offline fixture, not a new live interpretation.");
    await expect(region.locator(".inline-explanation-details")).toContainText("This does not establish sender intent.");
    await expect(region.getByRole("button",{name:t("Details","详情"),exact:true})).toBeEnabled();
    const before=await region.locator(".inline-emoji-result").innerText();
    const choices=row.locator(".emoji-inspector-choices button");
    if(await choices.count()===2){
      await choices.nth(1).click();await expect(row.locator(".emoji-enlarged")).toHaveText("🙂");
      await expect(region.locator(".inline-emoji-result")).toHaveText(before,{useInnerText:true});
      expect(requests).toHaveLength(index*2+2);
      const body=JSON.parse(requests.at(-1)!),payload=JSON.parse(body.messages[1].content[0].text);
      expect(payload.target).toEqual({kind:"emoji",emoji:"🙏 🙂"});expect(body.messages[1].content).toHaveLength(1);
    }
    proofs.push({messageIndex:[3,4,5,6,7][index],requestCount:requests.length,scope:await region.locator(".inline-emoji-scope").innerText(),
      initial:initial[index],result:before});
  }
  const dir=resolve(".local","visual-context","emoji-consistent-offline");await mkdir(dir,{recursive:true});
  await writeFile(resolve(dir,`states-${language}.json`),JSON.stringify({fixtureOnly:true,paidCalls:0,proofs},null,2));
  await rows[4].screenshot({path:resolve(dir,`${language}-multi-result-fixture.png`)});
  expect(requests).toHaveLength(10);
});
test("Unicode in an image message retains the authoritative visual target rather than claiming a per-glyph analysis",async({page})=>{
  const room=await demo(page),message=room.messages[4];
  expect((await api(page,"edit",{id:message.id,text:"I'll help. 🙏🙂",speaker:message.speaker})).status).toBe(200);
  await page.reload();await expect(page.getByTestId("chat-message")).toHaveCount(9);
  const row=page.getByTestId("chat-message").nth(4);
  await row.locator(".emoji-inspector > summary").click();
  await row.locator(".custom-emoji-artwork summary").click();
  const unicode=row.locator(".emoji-inspector .inline-emoji-explanation"),custom=row.locator(".custom-emoji-artwork .inline-emoji-explanation");
  expect(await unicode.innerText()).toBe(await custom.innerText());expect(requests).toHaveLength(0);
  await unicode.getByRole("button",{name:"Explain with AI",exact:true}).click();
  await expect(custom.locator(".inline-emoji-result")).toBeVisible();
  expect(await unicode.locator(".inline-emoji-result").innerText()).toBe(await custom.locator(".inline-emoji-result").innerText());
  const body=JSON.parse(requests[0]),payload=JSON.parse(body.messages[1].content[0].text);
  expect(payload.target).toEqual({kind:"visual",source:"original-custom-emoji",selectedContext:"c4"});
  expect(payload.frames).toHaveLength(1);expect(body.messages[1].content).toHaveLength(2);
  await row.locator(".emoji-inspector-choices button").nth(1).click();
  await expect(unicode.locator(".inline-emoji-scope")).toContainText("not only the previewed symbol");
  expect(requests).toHaveLength(1);
});
for(const language of ["en","zh-CN"])test(`${language}: film/GIF/custom/Unicode share explicit analysis and complete local details without opening the AI drawer`,async({page})=>{
  identify=true;const room=await demo(page,language),t=(en:string,zh:string)=>language==="en"?en:zh;
  await page.setViewportSize({width:390,height:900});
  await page.getByRole("button",{name:t("Hide AI panel","收起 AI 面板"),exact:true}).click();
  for(const [count,index] of [1,2,3,4,5,6,7].entries()){
    const row=page.getByTestId("chat-message").nth(index),disclosure=row.locator(".emoji-enlargement").first();
    await disclosure.locator(":scope > summary").click();
    const inline=disclosure.locator(".inline-emoji-explanation");
    expect(requests).toHaveLength(count);
    if(index===1||index===2){
      await expect(disclosure.locator("summary")).toHaveText(index===2?t("Enlarge GIF","放大 GIF"):t("Enlarge image","放大图片"));
      const image=disclosure.locator(".message-visual-image");
      await expect(image).toHaveAttribute("src",room.messages[index].attachment.dataUrl);
      if(index===2)expect((await sharp(Buffer.from((await image.getAttribute("src"))!.split(",")[1],"base64"),{animated:true}).metadata()).pages).toBe(12);
      expect(await image.evaluate((el:HTMLImageElement)=>el.getBoundingClientRect().width<=el.naturalWidth/devicePixelRatio+1)).toBe(true);
    }
    const reviewWait=page.waitForResponse(r=>r.url().endsWith("/local/review"));
    await inline.getByRole("button",{name:t("Explain with AI","AI解释"),exact:true}).click();
    const review=await(await reviewWait).json();
    await expect(inline.locator(".inline-emoji-result")).toBeVisible();
    expect(review.media.samples.map((s:{assetId:string})=>s.assetId)).toEqual([5,7].includes(index)?[]:Array(index===2?2:1).fill(room.messages[index].id));
    if(index===1||index===2){
      await expect(inline.locator(".inline-emoji-result .explanation-source")).toContainText("Offline fixture work");
      await expect(inline.locator(".inline-emoji-result")).not.toContainText("An offline fixture, not a new live interpretation.");
    }
    if([3,4,6].includes(index))await expect(inline.locator(".inline-explanation-details .explanation-background")).toContainText(t("cannot be identified confidently","无法"));
    if([5,7].includes(index))await expect(inline.locator(".explanation-background")).toHaveCount(0);
    const button=inline.getByRole("button",{name:t("Details","详情"),exact:true});
    await button.focus();await page.keyboard.press("Enter");
    const details=inline.locator(".inline-explanation-details");await expect(details).toBeVisible();
    await expect(details.getByRole("heading")).toHaveCount(5);
    await expect(details).toContainText("Ask neutrally.");
    await expect(details).toContainText(`Offline contextual fixture ${count+1}`);
    await expect(details).toContainText("An offline fixture, not a new live interpretation.");
    if(index===1||index===2)await expect(details).toContainText("An authored source-background fixture.");
    await expect(page.getByRole("button",{name:t("Open AI panel","打开 AI 面板"),exact:true})).toHaveAttribute("aria-expanded","false");
    expect(requests).toHaveLength(count+1);
    const rect=await details.boundingBox();expect(rect!.x+rect!.width).toBeLessThanOrEqual(390);
    await button.click();await expect(details).toBeHidden();
    if(index===2){
      const dir=resolve(".local","visual-context","visual-inline-offline");await mkdir(dir,{recursive:true});
      await row.screenshot({path:resolve(dir,`${language}-gif-fixture.png`)});
      await writeFile(resolve(dir,`${language}-gif-proof.json`),JSON.stringify({fixtureOnly:true,paidCalls:0,request:JSON.parse(requests.at(-1)!),review},null,2));
    }
  }
});
for(const category of ["image","sticker"] as const)test(`${category} uploads preserve small native pixels and use the same inline error/retry/details route`,async({page})=>{
  await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  const image=await sharp({create:{width:32,height:16,channels:3,background:"#446688"}}).png().toBuffer();
  await api(page,"message",{speaker:"Maya",text:"Owned fixture",attachment:{base64:image.toString("base64"),mime:"image/png",category}});
  await page.reload();await expect(page.getByTestId("chat-message")).toHaveCount(1);
  const row=page.getByTestId("chat-message"),trigger=row.locator(".message-visual-trigger");
  await trigger.focus();await page.keyboard.press("Enter");await expect(trigger).toHaveAttribute("aria-expanded","true");
  const disclosure=row.locator(".visual-enlargement"),inline=disclosure.locator(".inline-emoji-explanation");
  await expect(disclosure.locator("summary")).toHaveText(category==="sticker"?"Enlarge sticker":"Enlarge image");
  const pixels=disclosure.locator(".message-visual-image");await expect(pixels).toBeVisible();expect((await pixels.boundingBox())?.width).toBe(32);
  failure=true;await inline.getByRole("button",{name:"Explain with AI",exact:true}).click();
  await expect(inline.getByRole("alert")).toBeVisible();expect(requests).toHaveLength(1);
  failure=false;await inline.getByRole("button",{name:"Retry AI explanation",exact:true}).click();
  await expect(inline.locator(".inline-emoji-result")).toBeVisible();
  await expect(inline.locator(".inline-explanation-details .explanation-background")).toContainText("cannot be identified confidently");
  await inline.getByRole("button",{name:"Details",exact:true}).click();
  await expect(inline.locator(".inline-explanation-details")).toContainText("Ask neutrally.");
  await row.getByRole("button",{name:"Explain",exact:true}).click();expect(requests).toHaveLength(2);
  const body=JSON.parse(requests[1]);
  expect(await sharp(Buffer.from(body.messages[1].content[1].image_url.url.split(",")[1],"base64")).ensureAlpha().raw().toBuffer())
    .toEqual(await sharp(image).ensureAlpha().raw().toBuffer());
});
