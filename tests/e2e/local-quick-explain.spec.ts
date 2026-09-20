import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import {mkdir} from "node:fs/promises";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {emptySpeakerProfile} from "../../src/shared/expression";
let app:Awaited<ReturnType<typeof Factory>>,origin:string,inputs:Record<string,unknown>[],hold=false,bad:boolean|"references"|"service"|"network"|"refusal"|"truncation"=false,release:(()=>void)|undefined;
let imageUrls:string[],instruction:string,verbose=false;
let originMode:"unknown"|"identified"|"missing"|"invalid"="unknown";
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(name:string)=>pathToFileURL(resolve(root,"server",name)).href;
test.beforeEach(async()=>{
  inputs=[];imageUrls=[];instruction="";hold=false;bad=false;release=undefined;verbose=false;originMode="unknown";
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  app=await createLocalChatServer("OFFLINE-QUICK-EXPLAIN",{interaction:"direct-personal",cooldownMs:0,clientRoot:resolve(root,"client"),
    memeTransport:async()=>{throw new Error("Explain must not fetch a public catalog");},
    transport:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)),input=JSON.parse(body.messages[1].content[0].text);inputs.push(input);
      imageUrls=body.messages[1].content.flatMap((part:{image_url?:{url:string}})=>part.image_url?[part.image_url.url]:[]);
      instruction=body.messages[0].content;
      expect(body.response_format.json_schema.schema.required).toContain("background");
      expect(body.response_format.json_schema.schema.properties.background.properties.frames.items.enum)
        .toEqual(input.frames.length?input.frames.map((f:{id:string})=>f.id):undefined);
      const marker=`Explanation ${inputs.length}`;
      if(hold)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,5000);release=()=>{clearTimeout(timer);resolve();};});
      if(bad==="service")return new Response("PRIVATE_PROVIDER_BODY",{status:503});
      if(bad==="network")throw new TypeError("PRIVATE_NETWORK_DETAIL");
      if(bad==="refusal")return Response.json({choices:[{finish_reason:"stop",message:{refusal:"PRIVATE_REFUSAL",content:null}}]});
      if(bad==="truncation")return Response.json({choices:[{finish_reason:"length",message:{content:"{}"}}]});
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(bad===true?{invalid:true}:{
        background:originMode==="missing"?undefined:originMode==="invalid"?{source:null,context:"Generic control meme",frames:[]}:
          originMode==="identified"?{source:input.preferences.outputLanguage==="en"?"Alice in Wonderland":"《爱丽丝梦游仙境》",
            context:input.preferences.outputLanguage==="en"?"Alice reacts to a strange world.":"爱丽丝对奇异世界感到惊讶。",frames:input.frames.map((f:{id:string})=>f.id)}:
            {source:null,context:null,frames:[]},
        observations:[{text:`Visible fixture ${inputs.length}`,frames:bad==="references"?["unsupplied-frame"]:input.frames.map((f:{id:string})=>f.id)}],
        commonUsage:["Generic meme about control or unification.","Fixture usage"],
        contextualInterpretations:[{text:verbose?(input.preferences.outputLanguage==="en"?
          "The raised cup may suggest quiet relief after the fix, rather than a request for a drink. ".repeat(10).trim():
          "图里的举杯可能是在问题修好后松了一口气，不一定是在要饮料。".repeat(20)):marker,context:input.context.map((c:{label:string})=>c.label)},
          ...(verbose?[{text:"Another reading remains possible.",context:input.context.map((c:{label:string})=>c.label)}]:[])],
        uncertainties:["Not actual intent"],safeResponseGuidance:["Ask kindly"]
      })}}]});
    }
  });origin=await app.start(0);
});
test.afterEach(async()=>{release?.();await app.close();});
async function open(page:Page){await page.goto(origin+"/chat");await page.getByLabel("Language / 语言").selectOption("en");await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeEnabled();}
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const s=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    return (await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":s.csrf},
      body:JSON.stringify({revision:s.revision,...body})})).json();
  },{path,body});
}
async function visualMessage(page:Page,speaker:string,text:string){
  const bytes=await sharp({create:{width:32,height:32,channels:3,background:"#426ca5"}}).png().toBuffer();
  return api(page,"message",{speaker,text,attachment:{base64:bytes.toString("base64"),mime:"image/png",category:"image"}});
}
for(const kind of ["image","jpeg","gif","sticker"] as const)test(`one ${kind} Explain click directly produces a bounded result; uploading does not dispatch`,async({page})=>{
  await open(page);
  const pixels=Buffer.alloc(64*64*3*(kind==="gif"?2:1),120);
  if(kind==="gif")pixels.fill(200,64*64*3);
  const image=sharp(pixels,{raw:{width:64,height:kind==="gif"?128:64,channels:3,...(kind==="gif"?{pageHeight:64}:{})}});
  const buffer=kind==="gif"?await image.gif({delay:[200,300],loop:0}).toBuffer():kind==="jpeg"?await image.jpeg().toBuffer():await image.png().toBuffer();
  await page.getByLabel("Message",{exact:true}).fill("Original fictional visual");
  await page.getByLabel("Attach visual").setInputFiles({name:kind==="gif"?"fixture.gif":kind==="jpeg"?"fixture.jpg":"fixture.png",mimeType:kind==="gif"?"image/gif":kind==="jpeg"?"image/jpeg":"image/png",buffer});
  if(kind==="sticker")await page.getByRole("combobox",{name:"Visual type",exact:true}).selectOption("sticker");
  await page.getByRole("button",{name:"Add locally",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(1);expect(inputs).toHaveLength(0);
  for(let i=1;i<14;i++)await api(page,"message",{speaker:"Alex",text:`C${i}`});
  await page.reload();
  await expect(page.getByTestId("chat-message")).toHaveCount(14);
  const button=page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true});
  const reviewed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/review");
  const processed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/process");
  await button.evaluate((e:HTMLButtonElement)=>{e.click();e.click();});
  await expect(page.getByRole("heading",{name:"Possible meaning",exact:true})).toBeVisible();
  const review=await (await reviewed).json(),result=(await (await processed).json()).result;
  expect(review.input.context).toHaveLength(10);
  expect(review.input.context[0].text).toContain("Original fictional visual");
  expect(review.input.context.slice(1).map((c:{text:string})=>c.text)).toEqual(Array.from({length:9},(_,i)=>`Alex: C${i+5}`));
  expect(inputs[0].preferences).toMatchObject({outputLanguage:"en"});
  expect(result.explanation.observations[0].frames).toEqual(review.media.samples.map((f:{id:string})=>f.id));
  expect(result.explanation.contextualInterpretations[0].context).toEqual(review.input.context.map((c:{label:string})=>c.label));
  const panel=page.getByRole("heading",{name:"Possible meaning",exact:true}).locator("..");
  await expect(panel.locator(".explanation-brief")).toHaveText("Possible meaning here: Explanation 1");
  await expect(panel.locator("li").first()).toContainText("Visible fixture 1");
  await expect(panel.locator("li").first()).not.toBeVisible();
  for(const ref of [...result.explanation.observations[0].frames,...result.explanation.contextualInterpretations[0].context])
    await expect(panel.locator(".explanation-details")).toContainText(ref);
  await expect(page.getByRole("region",{name:"Transmission preview"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Explain with AI",exact:true})).toHaveCount(0);
  expect(inputs).toHaveLength(1);expect(inputs[0].frames).toHaveLength(kind==="gif"?2:1);
  expect(inputs[0].target).toEqual({kind:"visual"});
  expect(inputs[0].speakerContext).toMatchObject({role:"selected-sender",profile:null});
  expect(app.counters.graphRequests).toBe(0);expect(app.memeCounters.metadataRequests).toBe(0);
});
for(const language of ["en","zh-CN"] as const)test(`brief ${language} preserves long qualifiers without clipping and reveals complete details by keyboard without another call`,async({page})=>{
  verbose=true;
  await open(page);await visualMessage(page,"Maya","The fix is finally working.");
  await page.reload();await page.getByLabel("Language / 语言").selectOption(language);
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const processed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/process");
  await page.getByTestId("chat-message").getByRole("button",{name:t("Explain","解释一下"),exact:true}).click();
  const response=await processed;expect(response.status()).toBe(200);
  const value=(await response.json()).result.explanation;
  const panel=page.locator(".explanation-panel"),brief=panel.locator(".explanation-brief"),details=panel.locator("details"),toggle=details.locator("summary");
  await expect(panel.getByRole("heading")).toHaveCount(1);
  await expect(panel.getByRole("paragraph")).toHaveCount(1);
  await expect(panel.getByRole("heading")).toHaveText(t("Possible meaning","可能的含义"));
  await expect(brief).toHaveText(t("Possible meaning here: ","此处可能含义：")+value.contextualInterpretations[0].text);
  const background=panel.locator(".explanation-background");
  await expect(background).toHaveText(t("Background: The source cannot be identified confidently from the selected visual.","背景：无法从所选图片或表情可靠识别出处。"));
  await expect(background).toBeHidden();
  await expect(background).not.toContainText(value.commonUsage[0]);
  await expect(details.getByText(value.commonUsage[0],{exact:true})).not.toBeVisible();
  await expect(toggle).toHaveText(t("Details","详情"));
  await expect(details).not.toHaveAttribute("open");
  expect(instruction).toContain("max30 English words/60 Chinese chars");
  expect(instruction).toContain("source=named work/franchise/quote/meme origin");
  expect(instruction).toContain("If unsure: source/context:null,frames:[]");
  expect(inputs).toHaveLength(1);
  const directory=resolve(".local","visual-context","source-background-validation");
  await mkdir(directory,{recursive:true});
  for(const width of [1440,320]){
    await page.setViewportSize({width,height:950});await brief.scrollIntoViewIfNeeded();
    const dimensions=await brief.evaluate(p=>({height:p.getBoundingClientRect().height,line:parseFloat(getComputedStyle(p).lineHeight),scroll:p.scrollHeight}));
    expect(Math.abs(dimensions.scroll-dimensions.height)).toBeLessThan(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:resolve(directory,`${language}-${width}-brief-mock.png`)});
  }
  await toggle.focus();await page.keyboard.press("Enter");await expect(details).toHaveAttribute("open");
  await expect(panel.getByRole("heading")).toHaveCount(6);
  await expect(panel.getByText(value.observations[0].text,{exact:true})).toBeVisible();
  await expect(panel.getByText(value.safeResponseGuidance[0],{exact:true})).toBeVisible();
  await expect(panel.getByText(value.contextualInterpretations[1].text,{exact:true})).toBeVisible();
  await expect(details.getByText(value.commonUsage[0],{exact:true})).toBeVisible();
  expect(await brief.evaluate(p=>Math.abs(p.scrollHeight-p.getBoundingClientRect().height)<2)).toBe(true);
  for(const ref of [...value.observations[0].frames,...value.contextualInterpretations[0].context])await expect(details).toContainText(ref);
  expect(inputs).toHaveLength(1);expect(app.memeCounters.metadataRequests).toBe(0);
  await toggle.focus();await page.keyboard.press("Space");await expect(details).not.toHaveAttribute("open");
  await expect(brief).toHaveText(t("Possible meaning here: ","此处可能含义：")+value.contextualInterpretations[0].text);
  expect(inputs).toHaveLength(1);
});
for(const language of ["en","zh-CN"] as const)test(`dedicated ${language} origin cites the selected quote image, never generic usage or the chat's guess`,async({page})=>{
  originMode="identified";
  await open(page);
  const image=await sharp(Buffer.from('<svg width="380" height="120"><rect width="380" height="120" fill="white"/><text x="14" y="65" font-family="Arial" font-size="24">Curiouser and curiouser!</text></svg>')).png().toBuffer();
  await api(page,"message",{speaker:"Maya",text:"The caption guesses a different space franchise.",attachment:{base64:image.toString("base64"),mime:"image/png",category:"image"}});
  await page.reload();await page.getByLabel("Language / 语言").selectOption(language);
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const processed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/process");
  await page.getByTestId("chat-message").getByRole("button",{name:t("Explain","解释一下"),exact:true}).click();
  const response=await processed;expect(response.status()).toBe(200);
  const result=(await response.json()).result.explanation;
  expect(result.background.frames).toEqual(result.observations[0].frames);
  expect(result.background.frames).toHaveLength(1);
  const background=page.locator(".explanation-background");
  await expect(page.locator(".explanation-source")).toContainText(t("Alice in Wonderland","《爱丽丝梦游仙境》"));
  await expect(background).toBeHidden();
  await expect(background).toContainText(t("Alice in Wonderland","《爱丽丝梦游仙境》"));
  await expect(background).toContainText(t("Alice reacts to a strange world.","爱丽丝对奇异世界感到惊讶。"));
  await expect(background).not.toContainText(result.commonUsage[0]);
  await expect(background).not.toContainText("different space franchise");
  expect(instruction).toContain("NEVER chat/captions or generic usage");
  expect(await sharp(Buffer.from(imageUrls[0].split(",")[1],"base64")).ensureAlpha().raw().toBuffer()).toEqual(await sharp(image).ensureAlpha().raw().toBuffer());
  await page.setViewportSize({width:320,height:950});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const directory=resolve(".local","visual-context","source-background-validation");
  await mkdir(directory,{recursive:true});await page.locator(".explanation-source").scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(directory,`${language}-source-320-mock.png`)});
  await page.locator(".explanation-details > summary").click();
  await expect(page.locator(".explanation-details").getByText(result.commonUsage[0],{exact:true})).toBeVisible();
  for(const ref of result.background.frames)await expect(page.locator(".explanation-details")).toContainText(ref);
  expect(inputs).toHaveLength(1);
});
for(const mode of ["missing","invalid"] as const)test(`a ${mode} source field fails closed with no generic-usage fallback or automatic repeat`,async({page})=>{
  originMode=mode;
  await open(page);await visualMessage(page,"Maya","Fictional caption");await page.reload();
  const processed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/process");
  await page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true}).click();
  const response=await processed;expect(response.status()).toBe(400);
  expect((await response.json()).code).toBe("model-output-invalid-schema");
  await expect(page.locator(".explanation-panel")).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(inputs).toHaveLength(1);
});
test("selected pixels are primary even when captions contradict them and another picture is present",async({page})=>{
  await open(page);
  for(const [speaker,text,color] of [["Maya","Caption claims an unseen blue whale.","#ff0000"],["Leo","The conversation says every picture is green.","#00ff00"]]){
    const bytes=await sharp({create:{width:32,height:32,channels:3,background:color}}).png().toBuffer();
    await api(page,"message",{speaker,text,attachment:{base64:bytes.toString("base64"),mime:"image/png",category:"image"}});
  }
  await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  await page.getByTestId("chat-message").first().getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".explanation-panel .explanation-brief")).toContainText("Explanation 1");
  expect(inputs[0].target).toEqual({kind:"visual"});expect(inputs[0].context).toHaveLength(2);
  expect(instruction).toContain("Selected pixels/emoji, not chat/caption");
  expect(instruction).toContain("chat/profiles secondary");
  expect(imageUrls).toHaveLength(1);
  const pixels=await sharp(Buffer.from(imageUrls[0].split(",")[1],"base64")).removeAlpha().raw().toBuffer();
  expect([...pixels.subarray(0,3)]).toEqual([255,0,0]);
  const room=await api(page,"state");
  const review=await api(page,"review",{command:"explainVisual",selectedId:room.messages[0].id,input:{
    version:0,intent:"",explanationTarget:{kind:"emoji",emoji:"😂"},context:room.messages.map((m:{id:string;text:string})=>({label:m.id,text:m.text,included:true,timestamp:""})),
    preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}
  }});
  expect(review.input.explanationTarget).toEqual({kind:"visual"});expect(inputs).toHaveLength(1);
});
test("menu Explain includes the older selected message plus nine recent messages and only the saved profile",async({page})=>{
  await open(page);
  await api(page,"speaker/profile",{speaker:"Maya",profile:{...emptySpeakerProfile(),tone:"Saved calm tone"}});
  await visualMessage(page,"Maya","Fictional context 0");
  for(let i=1;i<14;i++)await api(page,"message",{speaker:"Alex",text:`Fictional context ${i}`});
  await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  const first=page.getByTestId("chat-message").first();
  await first.getByRole("button",{name:"Message actions",exact:true}).click();
  await page.getByRole("menuitem",{name:"Explain this message",exact:true}).click();
  await expect(page.locator(".explanation-panel .explanation-brief")).toContainText("Explanation 1");
  expect(inputs[0].context).toHaveLength(10);
  expect((inputs[0].context as {text:string}[])[0].text).toBe("Maya: Fictional context 0");
  expect((inputs[0].context as {text:string}[]).slice(1).map(c=>c.text)).toEqual(Array.from({length:9},(_,i)=>`Alex: Fictional context ${i+5}`));
  await expect(page.getByTestId("chat-message")).toHaveCount(14);
  expect(inputs[0].speakerContext).toMatchObject({role:"selected-sender",profile:{tone:"Saved calm tone"}});
  await page.locator(".speaker-profile summary").click();
  await page.getByLabel("Speaker tone",{exact:true}).fill("UNSAVED DO NOT SEND");
  await expect(first.getByRole("button",{name:"Explain",exact:true})).toBeEnabled();
  await first.getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".explanation-panel .explanation-brief")).toContainText("Explanation 2");
  expect(JSON.stringify(inputs[1])).not.toContain("UNSAVED DO NOT SEND");
  await expect(page.getByText("Unsaved profile edits were not sent; the saved profile (or unknown) was used.",{exact:true})).toBeVisible();
});
test("cancelled work never replaces a new selection and keeps the real lease until it finishes",async({page})=>{
  await open(page);
  await visualMessage(page,"Maya","First fictional message");
  await visualMessage(page,"Leo","Second fictional message");
  await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  hold=true;await page.getByTestId("chat-message").first().getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Explaining this message"})).toBeVisible();
  await expect.poll(()=>inputs.length).toBe(1);
  await page.getByRole("button",{name:"Cancel request",exact:true}).click();
  expect(app.resources().paidBusy).toBe(true);
  release!();release=undefined;hold=false;await expect.poll(()=>app.resources().paidBusy).toBe(false);
  await expect(page.getByText("Explanation 1",{exact:false})).toHaveCount(0);
  await page.getByTestId("chat-message").last().getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".explanation-panel .explanation-brief")).toContainText("Explanation 2");
  await expect(page.getByText("Explanation 1",{exact:false})).toHaveCount(0);
  expect(inputs[1].speakerContext).toMatchObject({role:"selected-sender",profile:null});
});
test("failure is visible, retry is explicit, and optional context editing remains available",async({page})=>{
  await open(page);await visualMessage(page,"Alex","Fictional test only");await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  bad=true;await page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("could not be completed reliably");
  await expect(page.getByRole("alert")).not.toContainText(/inserted|review again/iu);
  expect(inputs).toHaveLength(1);
  bad=false;await page.getByRole("button",{name:"Retry explanation",exact:true}).click();
  await expect(page.locator(".explanation-panel .explanation-brief")).toContainText("Explanation 2");expect(inputs).toHaveLength(2);
  await page.getByRole("button",{name:"Edit context / reanalyze",exact:true}).click();
  await page.getByLabel("Context 1",{exact:true}).fill("Optional edited context");
  await page.getByRole("button",{name:"Review selected content",exact:true}).click();
  await expect(page.getByRole("region",{name:"Content confirmation"})).toContainText("Optional edited context");
  expect(inputs).toHaveLength(2);
});
for(const [mode,copy] of [
  ["references","refers to content outside your selection"],
  ["service","service is temporarily unavailable"],
  ["network","connection was interrupted"],
  ["refusal","request could not be fulfilled"],
  ["truncation","explanation is incomplete"]
] as const)test(`one-click ${mode} failure is distinct, private, and requires explicit retry`,async({page})=>{
  await open(page);await visualMessage(page,"Leo","Fictional owl context.");await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  bad=mode;
  await page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText(copy);
  await expect(page.getByRole("alert")).not.toContainText(/PRIVATE_|unsupplied-frame/);
  expect(inputs).toHaveLength(1);
  await expect(page.getByRole("heading",{name:"Possible meaning",exact:true})).toHaveCount(0);
  bad=false;await page.getByRole("button",{name:"Retry explanation",exact:true}).click();
  await expect(page.locator(".explanation-panel .explanation-brief")).toContainText("Explanation 2");expect(inputs).toHaveLength(2);
});

test("Chinese one-click validation failure asks to retry explanation, not insert or preview",async({page})=>{
  await open(page);await visualMessage(page,"Alex","Synthetic visual only");await page.reload();
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  bad=true;await page.getByTestId("chat-message").getByRole("button",{name:"解释一下",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("未能可靠地完成解释，请手动重试解释");
  await expect(page.getByRole("alert")).not.toContainText(/插入|预览/u);
  await expect(page.getByRole("button",{name:"重试解释",exact:true})).toBeEnabled();
  expect(inputs).toHaveLength(1);
});

test("closing a room during explanation cannot populate a newly opened room",async({page})=>{
  await open(page);await visualMessage(page,"Alex","Disposable synthetic room");await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  hold=true;await page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true}).click();
  await expect.poll(()=>inputs.length).toBe(1);
  page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Close this room",exact:true}).click();
  await expect(page.getByRole("heading",{name:"This room is closed",exact:true})).toBeVisible();
  release!();release=undefined;await expect.poll(()=>app.resources().paidBusy).toBe(false);
  await page.getByRole("button",{name:"Open a new local room",exact:true}).click();
  await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  await expect(page.getByTestId("chat-message")).toHaveCount(0);
  await expect(page.getByText("Explanation 1",{exact:false})).toHaveCount(0);
});

test("ordinary text has no Explain actions; forged direct requests fail specifically without dispatch",async({page})=>{
  await open(page);
  await api(page,"message",{speaker:"Maya",text:"Text can only provide contextual evidence."});
  const room=await api(page,"message",{speaker:"Alex",text:"ASCII 123 # * !?"});
  await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  for(const message of room.messages){
    const bubble=page.getByTestId("chat-message").filter({hasText:message.text});
    await expect(bubble.getByRole("button",{name:"Explain",exact:true})).toHaveCount(0);
    const trigger=bubble.getByRole("button",{name:"Message actions",exact:true});
    await trigger.focus();await trigger.press("ArrowDown");
    await expect(page.getByRole("menuitem",{name:"Explain this message",exact:true})).toHaveCount(0);
    await expect(page.getByRole("menuitem",{name:"Edit message",exact:true})).toBeFocused();
    await expect(page.getByRole("menuitem",{name:"Remove message",exact:true})).toBeEnabled();
    await page.keyboard.press("Escape");await expect(trigger).toBeFocused();
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/review");
    const rejected=await api(page,"review",{command:"explainVisual",selectedId:message.id,canExplain:true,input:{
      version:0,intent:"Explain",context:[],preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}
    }});
    expect((await response).status()).toBe(400);expect(rejected.code).toBe("local-visual-required");
  }
  expect((await api(page,"process",{consent:true,digest:"forged"})).code).toBe("processing-review-required");
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await expect(page.getByTestId("chat-message").getByRole("button",{name:"解释一下",exact:true})).toHaveCount(0);
  expect(inputs).toHaveLength(0);expect(app.counters.providerRequests).toBe(0);
});

for(const emoji of ["🙂","Friendly 🙂","🇨🇳","👍🏽","👩🏽‍💻","👨‍👩‍👧‍👦","❤️","1️⃣"])test(`emoji ${emoji} one-click Explain uses real text review and saved sender without image samples`,async({page})=>{
  await open(page);
  await api(page,"speaker/profile",{speaker:"Maya",profile:{...emptySpeakerProfile(),tone:"Saved gentle tone"}});
  await api(page,"message",{speaker:"Alex",text:"Fabricated ordinary context"});
  await api(page,"message",{speaker:"Maya",text:emoji});
  await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  expect(inputs).toHaveLength(0);
  await expect(page.getByTestId("chat-message").first().getByRole("button",{name:"Explain",exact:true})).toHaveCount(0);
  const bubble=page.getByTestId("chat-message").last();
  await expect(bubble.getByRole("button",{name:"Explain",exact:true})).toBeEnabled();
  await bubble.getByRole("button",{name:"Message actions",exact:true}).click();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/review");
  await page.getByRole("menuitem",{name:"Explain this message",exact:true}).click();
  const review=await (await response).json();expect(review.media.samples).toEqual([]);
  await expect(page.locator(".explanation-panel .explanation-brief")).toContainText("Explanation 1");
  expect(inputs).toHaveLength(1);expect(inputs[0].frames).toEqual([]);
  expect(inputs[0].target).toEqual({kind:"emoji",emoji:emoji.replace("Friendly ","")});
  expect(imageUrls).toEqual([]);
  expect(inputs[0].speakerContext).toMatchObject({role:"selected-sender",profile:{tone:"Saved gentle tone"}});
  expect(inputs[0].context).toEqual(expect.arrayContaining([
    expect.objectContaining({text:`Maya: ${emoji}`}),expect.objectContaining({text:"Alex: Fabricated ordinary context"})
  ]));
  expect(app.counters.providerRequests).toBe(1);expect(app.counters.graphRequests).toBe(0);
});

test("removing emoji from a message revokes its review and hides direct and retry eligibility",async({page})=>{
  await open(page);const room=await api(page,"message",{speaker:"Maya",text:"Hello 🙂"});
  const message=room.messages[0],input={version:0,intent:"Explain",context:[{label:message.id,text:"Hello 🙂",included:true,timestamp:""}],
    preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}};
  const review=await api(page,"review",{command:"explainVisual",selectedId:message.id,input});
  expect(review.media.samples).toEqual([]);
  await api(page,"edit",{id:message.id,speaker:"Maya",text:"Hello"});
  expect((await api(page,"process",{digest:review.processing.digest,consent:true})).code).toBe("processing-review-required");
  expect((await api(page,"review",{command:"explainVisual",selectedId:message.id,input})).code).toBe("local-visual-required");
  await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Retry explanation",exact:true})).toHaveCount(0);
  expect(inputs).toHaveLength(0);
});

for(const mutation of ["edit","remove"] as const)test(`visual ${mutation} invalidates a prepared digest and never dispatches stale work`,async({page})=>{
  await open(page);const room=await visualMessage(page,"Maya","Original caption");
  const message=room.messages[0],input={version:0,intent:"Explain",context:[{label:message.id,text:"Original caption",included:true,timestamp:""}],
    preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}};
  const review=await api(page,"review",{command:"explainVisual",selectedId:message.id,input});
  expect(review.media.samples).toHaveLength(1);
  await api(page,mutation,{id:message.id,...(mutation==="edit"?{speaker:"Maya",text:"Updated caption"}:{})});
  expect((await api(page,"process",{digest:review.processing.digest,consent:true})).code).toBe("processing-review-required");
  await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  if(mutation==="remove"){
    await expect(page.getByTestId("chat-message")).toHaveCount(0);
    await expect(page.getByRole("button",{name:"Retry explanation",exact:true})).toHaveCount(0);
  }else{
    await expect(page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true})).toBeEnabled();
  }
  expect(inputs).toHaveLength(0);
});
