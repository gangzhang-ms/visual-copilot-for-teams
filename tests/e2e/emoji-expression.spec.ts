import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,requests:string[],otherCalls:number,hold:boolean,bad:boolean,unavailable:boolean,release:(()=>void)|undefined;
const options=()=>({options:[
  {emojis:["👩🏽‍💻","🎉"],label:"Warm celebration",reason:"Celebrate their work",caution:"Keep it gentle",text:"Well done"},
  {emojis:["🇺🇳","❤️"],label:"Shared support",reason:"Show solidarity",caution:"Flag context matters",text:"Together"},
  {emojis:["1️⃣","👍🏽"],label:"One step forward",reason:"Acknowledge progress",caution:"Thumbs-up may feel abrupt",text:"Nice progress"}
]});
test.beforeEach(async()=>{
  requests=[];otherCalls=0;hold=false;bad=false;unavailable=false;release=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const forbidden=async()=>{otherCalls++;throw new Error("Forbidden image/search transport");};
  app=await createLocalChatServer("OFFLINE",{clientRoot:resolve(root,"client"),interaction:"direct-personal",
    emojiExpressions:true,creationChoices:true,mixedCreation:true,contextualCreation:true,webCreation:true,webProvider:"serpapi",
    cooldownMs:0,catalogSource:"original-demo",memeTransport:forbidden,webSearchTransport:forbidden,generation:{transport:forbidden},
    transport:async(_url,init)=>{
      requests.push(String(init?.body));
      const b=JSON.parse(String(init?.body)),payload=JSON.parse(b.messages[1].content[0].text);
      expect(b.messages[1].content).toHaveLength(1);
      if(hold)await new Promise<void>(done=>{release=done;});
      if(unavailable)return Response.json({error:{code:"unavailable"}},{status:503});
      const output=payload.task==="explain"?{
        background:{source:null,context:null,frames:[]},
        observations:[{text:payload.target.emoji,frames:[]}],commonUsage:["Conventional meanings depend on context."],
        contextualInterpretations:[{text:"This could signal gentle irony.",context:payload.context.map((c:{label:string})=>c.label)}],
        uncertainties:["It could also be sincere; culture and platform matter."],safeResponseGuidance:["Ask what they meant."]
      }:bad?{options:[{...options().options[0],emojis:["<img>"]},...options().options.slice(1)]}:options();
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]});
    }
  });origin=await app.start(0);
});
test.afterEach(async()=>{release?.();await app.close();expect(otherCalls).toBe(0);});
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const state=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const r=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":state.csrf},
      body:JSON.stringify(path==="state"?body:{revision:state.revision,...body})});
    return {status:r.status,value:await r.json()};
  },{path,body});
}
async function open(page:Page,language="en"){
  await page.goto(origin+"/chat");if(language!=="en")await page.getByLabel("Language / 语言").selectOption(language);
  await page.locator(".local-tabs").getByRole("button",{name:language==="en"?"Express":"帮我表达",exact:true}).click();
  await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
}
for(const language of ["en","zh-CN"])test(`exact emoji suggestions preview into existing composer without sending in ${language}`,async({page})=>{
  const t=(en:string,zh:string)=>language==="en"?en:zh;await open(page,language);
  await page.getByLabel(t("What would you like to express?","你想表达什么？"),{exact:true}).fill("Celebrate using 👩🏽‍💻 and a warm tone");
  await page.getByLabel(t("Message","消息内容"),{exact:true}).fill("Keep my draft");
  const bytes=await sharp({create:{width:24,height:24,channels:3,background:"#459"}}).png().toBuffer();
  await page.locator(".local-composer input[type=file]").setInputFiles({name:"fixture.png",mimeType:"image/png",buffer:bytes});
  await expect(page.locator(".composer-attachment img")).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole("button",{name:t("Suggest emoji","推荐 emoji"),exact:true}).click();
  await expect(page.locator(".emoji-options article")).toHaveCount(3);
  expect(requests).toHaveLength(1);expect((await api(page,"state")).value.messages).toHaveLength(0);
  await page.getByRole("button",{name:t("Choose option 1","选择方案 1"),exact:true}).click();
  await page.getByLabel(t("Include accompanying text","附加配文"),{exact:true}).check();
  await expect(page.locator(".emoji-insertion")).toHaveText("Well done 👩🏽‍💻🎉");
  await page.getByRole("button",{name:t("Insert into composer","插入输入框"),exact:true}).click();
  await expect(page.getByLabel(t("Message","消息内容"),{exact:true})).toHaveValue("Keep my draft Well done 👩🏽‍💻🎉");
  await expect(page.locator(".composer-attachment img")).toBeVisible();
  expect((await api(page,"state")).value.messages).toHaveLength(0);expect(requests).toHaveLength(1);
});
test("emoji Explain preserves mixed exact sequences, common meaning and uncertain contextual reading",async({page})=>{
  await page.goto(origin+"/chat");
  await api(page,"message",{speaker:"Maya",text:"Finally 🙃👩🏽‍💻🇺🇳1️⃣❤️"});await page.reload();
  await page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".explanation-brief")).toBeVisible();
  const body=JSON.parse(requests[0]),payload=JSON.parse(body.messages[1].content[0].text);
  expect(payload.target).toEqual({kind:"emoji",emoji:"🙃 👩🏽‍💻 🇺🇳 1️⃣ ❤️"});expect(payload.frames).toEqual([]);
  await page.locator(".explanation-details > summary").click();await expect(page.locator(".explanation-details")).toContainText("Conventional meanings");
  await expect(page.locator(".explanation-panel")).toContainText("culture and platform");
  expect(requests).toHaveLength(1);
});
test("reply target is owned, included and bound; changing it cancels a pending result",async({page})=>{
  await page.goto(origin+"/chat");await api(page,"message",{speaker:"Maya",text:"Finished 🙃"});await api(page,"message",{speaker:"Leo",text:"Well done 🎉"});
  const state=(await api(page,"state")).value;await page.reload();await open(page);
  await page.getByLabel("Reply to message",{exact:true}).selectOption(state.messages[0].id);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("A gentle reply");hold=true;
  await page.getByRole("button",{name:"Suggest emoji",exact:true}).click();await expect.poll(()=>requests.length).toBe(1);
  const payload=JSON.parse(JSON.parse(requests[0]).messages[1].content[0].text);
  expect(payload.replyTo.text).toBe("Maya: Finished 🙃");
  await page.getByLabel("Reply to message",{exact:true}).selectOption(state.messages[1].id);release?.();
  await expect(page.getByRole("button",{name:"Suggest emoji",exact:true})).toBeEnabled();
  await expect(page.locator(".emoji-options article")).toHaveCount(0);expect(requests).toHaveLength(1);
});
test("invalid model output is explicit and never produces fallback emoji",async({page})=>{
  bad=true;await open(page);await page.getByLabel("What would you like to express?",{exact:true}).fill("Support");
  await page.getByRole("button",{name:"Suggest emoji",exact:true}).click();
  await expect(page.getByRole("alert")).toBeVisible();await expect(page.locator(".emoji-options article")).toHaveCount(0);
  expect(requests).toHaveLength(1);
});
test("composer overflow keeps draft and can be corrected without another model call",async({page})=>{
  await open(page);await page.getByLabel("What would you like to express?",{exact:true}).fill("Support");
  await page.getByRole("button",{name:"Suggest emoji",exact:true}).click();
  await page.getByRole("button",{name:"Choose option 3",exact:true}).click();
  await page.getByLabel("Message",{exact:true}).fill("x".repeat(2000));
  await page.getByRole("button",{name:"Insert into composer",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("2000");
  await expect(page.getByLabel("Message",{exact:true})).toHaveValue("x".repeat(2000));
  await page.getByLabel("Message",{exact:true}).fill("Okay");
  await page.getByRole("button",{name:"Insert into composer",exact:true}).click();
  await expect(page.getByLabel("Message",{exact:true})).toHaveValue("Okay 1️⃣👍🏽");expect(requests).toHaveLength(1);
});
test("stale selection and foreign context are rejected without an extra model call",async({page})=>{
  await open(page);await page.getByLabel("What would you like to express?",{exact:true}).fill("Support");
  const pending=page.waitForResponse(r=>r.url().endsWith("/local/emoji/suggest")&&r.ok());
  await page.getByRole("button",{name:"Suggest emoji",exact:true}).click();
  const {suggestions}=await(await pending).json();
  await api(page,"message",{speaker:"Maya",text:"Changed context"});
  expect((await api(page,"emoji/selection",{id:suggestions.id,digest:suggestions.digest,index:0,withText:false})).status).toBe(400);
  const d={intent:"x",language:"en",replyTo:"foreign",context:[{label:"foreign",text:"x",included:true}],
    preferences:{formality:"unknown",familiarity:"",relationship:"",humor:"",avoid:""}};
  expect((await api(page,"emoji/suggest",{draft:d})).status).toBe(400);expect(requests).toHaveLength(1);
});
test("switching emoji/image mode alone never dispatches, and image controls remain available",async({page})=>{
  await open(page);await page.getByRole("radio",{name:"Images / GIFs",exact:true}).check();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await expect(page.getByRole("button",{name:"Create 3 options",exact:true})).toBeVisible();
  await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
  await expect(page.getByRole("button",{name:"Suggest emoji",exact:true})).toBeVisible();
  expect(requests).toHaveLength(0);
});
test("result capabilities cannot be inserted from a different room",async({page,browser})=>{
  await open(page);await page.getByLabel("What would you like to express?",{exact:true}).fill("Support");
  const response=page.waitForResponse(r=>r.url().endsWith("/local/emoji/suggest")&&r.ok());
  await page.getByRole("button",{name:"Suggest emoji",exact:true}).click();const {suggestions}=await(await response).json();
  const other=await browser.newContext();
  try{
    const second=await other.newPage();await second.goto(origin+"/chat");
    expect((await api(second,"emoji/selection",{id:suggestions.id,digest:suggestions.digest,index:0,withText:false})).status).toBe(400);
    expect((await api(second,"state")).value.messages).toHaveLength(0);
  }finally{await other.close();}
  expect(requests).toHaveLength(1);
});
test("mode change cancels pending emoji and plain text alone still cannot be explained",async({page})=>{
  await page.goto(origin+"/chat");await api(page,"message",{speaker:"Maya",text:"Plain text"});await page.reload();
  await expect(page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true})).toHaveCount(0);
  await open(page);await page.getByLabel("What would you like to express?",{exact:true}).fill("Support");hold=true;
  await page.getByRole("button",{name:"Suggest emoji",exact:true}).click();await expect.poll(()=>requests.length).toBe(1);
  await page.getByRole("radio",{name:"Images / GIFs",exact:true}).check();release?.();
  await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
  await expect(page.locator(".emoji-options article")).toHaveCount(0);expect(requests).toHaveLength(1);
});
test("provider failure is shown without an automatic paid retry or fabricated success",async({page})=>{
  unavailable=true;await open(page);await page.getByLabel("What would you like to express?",{exact:true}).fill("Support");
  await page.getByRole("button",{name:"Suggest emoji",exact:true}).click();
  await expect(page.getByRole("alert")).toBeVisible();await expect(page.locator(".emoji-options article")).toHaveCount(0);
  expect(requests).toHaveLength(1);
});
for(const language of ["en","zh-CN"])test(`enlargement and individual identification are local, exact and accessible in ${language}`,async({page})=>{
  await page.goto(origin+"/chat");
  const sequences=["🙏","🙂","👩🏽‍💻","🇺🇳","1️⃣","❤️","👨‍👩‍👧‍👦","😮‍💨","🙏🏽","🫠"];
  await api(page,"message",{speaker:"Maya",text:"Which symbol? "+sequences.join("")});await page.reload();
  if(language==="zh-CN")await page.getByLabel("Language / 语言").selectOption(language);
  const inspector=page.getByTestId("chat-message").locator(".emoji-inspector");
  await inspector.locator("summary").click();
  await expect(inspector.locator(".emoji-enlarged")).toHaveText("🙏");
  await expect(inspector.locator(".emoji-identity-name")).toContainText(language==="en"?"Folded hands":"合十的双手");
  await expect(inspector.locator(".emoji-possible-uses,.emoji-identity-caution")).toHaveCount(0);
  await expect(inspector.getByRole("button",{name:language==="en"?"Explain with AI":"AI解释",exact:true})).toBeVisible();
  expect(await inspector.locator(".emoji-enlarged").evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(80);
  const choices=inspector.getByRole("group");
  for(let i=1;i<8;i++){await choices.getByRole("button").nth(i).click();await expect(inspector.locator(".emoji-enlarged")).toHaveText(sequences[i]);}
  await inspector.getByRole("button",{name:language==="en"?"Next emoji":"下一组 emoji",exact:true}).click();
  await expect(inspector.locator(".emoji-enlarged")).toHaveText("🙏🏽");
  const unknown=choices.getByRole("button").nth(1);
  await unknown.focus();await page.keyboard.press("Enter");
  await expect(inspector.locator(".emoji-enlarged")).toHaveText("🫠");
  await expect(inspector.locator(".emoji-codepoints")).toHaveText("U+1FAE0");
  await expect(inspector.locator(".emoji-identity-name")).toContainText(language==="en"?"Local name unavailable":"暂无本地名称");
  expect(requests).toHaveLength(0);expect((await api(page,"state")).value.messages).toHaveLength(1);
});
test("emoji explanation foregrounds uncertainty while keeping per-symbol inspection inference-free",async({page})=>{
  await page.goto(origin+"/chat");await api(page,"message",{speaker:"Maya",text:"Thanks? 🙏🙂"});await page.reload();
  await page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true}).click();
  const panel=page.locator(".explanation-panel");
  await expect(panel.locator(".explanation-brief")).toBeVisible();
  await panel.locator(".emoji-inspector > summary").click();
  await expect(panel.locator(".emoji-enlarged")).toHaveText("🙏");
  await expect(panel.locator(".explanation-brief")).toContainText("Possible meaning here");
  await expect(panel.locator(".explanation-details")).toContainText("culture and platform");
  await panel.getByRole("button",{name:"2: Slightly smiling face",exact:true}).click();
  await expect(panel.locator(".emoji-enlarged")).toHaveText("🙂");
  await expect(panel.locator(".emoji-possible-uses,.emoji-identity-caution")).toHaveCount(0);
  await expect(panel.locator(".inline-emoji-scope")).toContainText("not only the previewed symbol");
  await expect(panel.locator(".inline-emoji-meaning")).toContainText("This could signal gentle irony.");
  expect(requests).toHaveLength(1);
  const instruction=JSON.parse(requests[0]).messages[0].content;
  expect(instruction).toContain("never infer culture/religion/nationality");
  expect(instruction).toContain("not invented cultural facts for every symbol");
});
