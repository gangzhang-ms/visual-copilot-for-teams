import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import {readFile} from "node:fs/promises";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
let app:Awaited<ReturnType<typeof Factory>>,origin:string,inputs:Record<string,unknown>[];
let imageUrls:string[][];
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(name:string)=>pathToFileURL(resolve(root,"server",name)).href;
test.beforeEach(async()=>{
  inputs=[];imageUrls=[];
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  app=await createLocalChatServer("OFFLINE-COMPOSER",{interaction:"direct-personal",cooldownMs:0,clientRoot:resolve(root,"client"),
    memeTransport:async()=>{throw new Error("Composer/demo must not fetch Internet media");},
    transport:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)),input=JSON.parse(body.messages[1].content[0].text);inputs.push(input);
      imageUrls.push(body.messages[1].content.filter((c:{type:string})=>c.type==="image_url").map((c:{image_url:{url:string}})=>c.image_url.url));
      expect(body.response_format.type).toBe("json_schema");
      expect(body.response_format.json_schema.schema.properties.observations.items.properties.frames.items.enum).toEqual(input.frames.length?input.frames.map((f:{id:string})=>f.id):undefined);
      expect(body.response_format.json_schema.schema.properties.contextualInterpretations.items.properties.context.items.enum).toEqual(input.context.length?input.context.map((c:{label:string})=>c.label):undefined);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        background:{source:null,context:null,frames:[]},observations:[{text:"Fixture illustration",frames:input.frames.map((f:{id:string})=>f.id)}],commonUsage:["Possible expression"],
        contextualInterpretations:[{text:"Synthetic context only",context:input.context.map((c:{label:string})=>c.label)}],
        uncertainties:["Not actual sender intent"],safeResponseGuidance:["Ask kindly"]
      })}}]});
    }});origin=await app.start(0);
});
test.afterEach(async()=>{await app.close();});
async function open(page:Page){
  await page.goto(origin+"/chat");await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
}
async function file(name="owned.png",gif=false){
  const bytes=Buffer.alloc(32*32*3*(gif?2:1),100);if(gif)bytes.fill(200,32*32*3);
  const image=sharp(bytes,{raw:{width:32,height:gif?64:32,channels:3,...(gif?{pageHeight:32}:{})}});
  return {name,type:gif?"image/gif":"image/png",base64:(await (gif?image.gif({delay:[200,300]}):image.png()).toBuffer()).toString("base64")};
}
type FileData={name:string;type:string;base64?:string;size?:number};
async function transfer(page:Page,kind:"paste"|"drop",files:FileData[]){
  return page.evaluate(({kind,files})=>{
    const data=new DataTransfer();
    for(const f of files)data.items.add(new File([f.size?new Uint8Array(f.size):Uint8Array.from(atob(f.base64??""),c=>c.charCodeAt(0))],f.name,{type:f.type}));
    const event=kind==="paste"?new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:data}):new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:data});
    document.querySelector("textarea")!.dispatchEvent(event);return event.defaultPrevented;
  },{kind,files});
}
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const session=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const r=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:JSON.stringify({revision:session.revision,...body})});
    return {status:r.status,value:await r.json()};
  },{path,body});
}
test("clipboard PNG, dropped GIF and picker share visible preview and manual image-only/caption sending",async({page})=>{
  await open(page);const png=await file(),gif=await file("owned.gif",true);
  expect(await transfer(page,"paste",[png])).toBe(true);
  await expect(page.getByAltText("Attachment preview")).toBeVisible();expect(inputs).toHaveLength(0);
  await page.getByRole("button",{name:"Add locally",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
  await expect(page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true})).toBeEnabled();
  await transfer(page,"drop",[gif]);await expect(page.getByAltText("Attachment preview")).toHaveAttribute("src",/^data:image\/gif/);
  await page.getByLabel("Message",{exact:true}).fill("Caption remains manual");await page.getByLabel("Message",{exact:true}).press("Enter");
  await expect(page.getByTestId("chat-message")).toHaveCount(2);
  await expect(page.getByTestId("chat-message").last()).toContainText("Caption remains manual");
  await page.getByLabel("Attach visual").setInputFiles({name:png.name,mimeType:png.type,buffer:Buffer.from(png.base64,"base64")});
  await expect(page.getByAltText("Attachment preview")).toBeVisible();await page.getByRole("button",{name:"Remove attachment",exact:true}).click();
  await expect(page.getByAltText("Attachment preview")).toHaveCount(0);
  await page.getByLabel("Attach visual").setInputFiles({name:png.name,mimeType:png.type,buffer:Buffer.from(png.base64,"base64")});
  await expect(page.getByAltText("Attachment preview")).toBeVisible();
  await page.setViewportSize({width:320,height:900});
  if(await page.getByRole("button",{name:"Hide AI panel",exact:true}).isVisible())await page.getByRole("button",{name:"Hide AI panel",exact:true}).click();
  const box=await page.getByAltText("Attachment preview").boundingBox();expect(box!.y+box!.height).toBeLessThan(900);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(inputs).toHaveLength(0);expect(app.memeCounters.metadataRequests).toBe(0);
});
test("invalid or multiple replacements preserve accepted image and text; HTML/URL is not fetched",async({page})=>{
  await open(page);const png=await file();await transfer(page,"paste",[png]);
  await expect(page.getByAltText("Attachment preview")).toBeVisible();const src=await page.getByAltText("Attachment preview").getAttribute("src");
  await page.getByLabel("Message",{exact:true}).fill("Keep this draft");
  for(const files of [[png,png],[{name:"big.png",type:"image/png",size:1024*1024+1}],[{name:"bad.svg",type:"image/svg+xml",base64:"YQ=="}],[{name:"corrupt.png",type:"image/png",base64:"YQ=="}]]){
    await transfer(page,"drop",files);await expect(page.getByRole("form",{name:"Message composer"}).getByRole("alert")).toBeVisible();
    await expect(page.getByAltText("Attachment preview")).toHaveAttribute("src",src!);
    await expect(page.getByLabel("Message",{exact:true})).toHaveValue("Keep this draft");
  }
  const outbound:string[]=[];page.on("request",r=>{if(!r.url().startsWith(origin))outbound.push(r.url());});
  expect(await page.evaluate(()=>{
    const data=new DataTransfer();data.setData("text/plain","ordinary pasted text");data.setData("text/html",'<img src="https://example.invalid/private.png">');
    const event=new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:data});
    document.querySelector("textarea")!.dispatchEvent(event);return event.defaultPrevented;
  })).toBe(false);
  expect(outbound).toEqual([]);expect(inputs).toHaveLength(0);
  const rejected=await api(page,"message",{speaker:"Alex",text:"Invalid fixture",attachment:{mime:"image/png",base64:"YQ==",category:"image"}});
  expect(rejected.status).toBe(400);expect(rejected.value.code).toBe("unsupported-format");
  expect((await api(page,"state")).value.messages).toHaveLength(0);
});
test("read races ignore analysis epochs, failed reads preserve old image, and remove/reset/close prevent resurrection",async({page})=>{
  await page.addInitScript(()=>{
    const read=FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL=function(blob:Blob){
      const name=blob instanceof File?blob.name:"";
      if(name.startsWith("fail")){setTimeout(()=>this.onerror?.call(this,new ProgressEvent("error") as ProgressEvent<FileReader>),30);return;}
      setTimeout(()=>read.call(this,blob),name.startsWith("slow")?350:0);
    };
  });
  await open(page);const good=await file(),slow=await file("slow.png");
  await transfer(page,"paste",[slow]);
  await page.getByLabel("Message",{exact:true}).fill("Typing does not drop an image");
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await expect(page.getByAltText("附件预览")).toBeVisible();
  await page.getByLabel("Language / 语言").selectOption("en");
  await transfer(page,"paste",[{...good,name:"fail.png"}]);await expect(page.getByRole("form").getByRole("alert")).toContainText("Could not read");
  await expect(page.getByAltText("Attachment preview")).toBeVisible();
  await transfer(page,"paste",[slow]);await transfer(page,"drop",[await file("fast.gif",true)]);
  await expect(page.getByAltText("Attachment preview")).toHaveAttribute("src",/^data:image\/gif/);
  await page.waitForTimeout(450);await expect(page.getByAltText("Attachment preview")).toHaveAttribute("src",/^data:image\/gif/);
  await transfer(page,"paste",[slow]);await page.getByRole("button",{name:"Remove attachment",exact:true}).click();
  await page.waitForTimeout(450);await expect(page.getByAltText("Attachment preview")).toHaveCount(0);
  await transfer(page,"paste",[slow]);await page.getByRole("button",{name:"Clear room",exact:true}).click();
  await page.waitForTimeout(450);await expect(page.getByAltText("Attachment preview")).toHaveCount(0);
  await transfer(page,"paste",[slow]);page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Close this room",exact:true}).click();
  await page.getByRole("button",{name:"Open a new local room",exact:true}).click();
  await page.waitForTimeout(450);await expect(page.getByAltText("Attachment preview")).toHaveCount(0);
  await transfer(page,"paste",[slow]);await page.goto(origin+"/manual");await open(page);
  await page.waitForTimeout(450);await expect(page.getByAltText("Attachment preview")).toHaveCount(0);
  expect(inputs).toHaveLength(0);
});
test("busy and edit rejection stays in the composer and preserves existing draft media",async({page})=>{
  await open(page);await api(page,"message",{speaker:"Alex",text:"Editable ordinary text"});await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  const png=await file();await transfer(page,"paste",[png]);await expect(page.getByAltText("Attachment preview")).toBeVisible();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/local/cancel",async route=>{await gate;await route.continue();});
  try{
    await page.getByRole("button",{name:"Help me express",exact:true}).click();
    await transfer(page,"drop",[png]);
    await expect(page.getByRole("form").getByRole("alert")).toContainText("Wait for the current request");
    await expect(page.getByAltText("Attachment preview")).toBeVisible();
  }finally{release();}
  await expect(page.getByTestId("chat-message").getByRole("button",{name:"Edit",exact:true})).toBeEnabled();
  await page.unroute("**/local/cancel");
  await page.getByRole("button",{name:"Remove attachment",exact:true}).click();
  await page.getByTestId("chat-message").getByRole("button",{name:"Edit",exact:true}).click();
  await transfer(page,"paste",[png]);
  await expect(page.getByRole("form").getByRole("alert")).toContainText("finish editing");
  await expect(page.getByAltText("Attachment preview")).toHaveCount(0);
  await expect(page.getByLabel("Message",{exact:true})).toHaveValue("Editable ordinary text");
  expect(inputs).toHaveLength(0);
});
for(const language of ["en","zh-CN"])test(`${language} demo atomically loads five messages with PNG, GIF and emoji; repeat cannot overwrite; each visual explains`,async({page})=>{
  await open(page);
  await page.getByLabel("Language / 语言").selectOption(language);
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/demo");
  await page.getByRole("button",{name:t("Start a demo conversation","从演示对话开始"),exact:true}).click();
  const r=await response;expect(r.status()).toBe(200);const room=await r.json();
  expect(room.messages).toHaveLength(5);
  expect(room.messages.map((m:{text:string})=>m.text)).toEqual(language==="en"?[
    "Proposal: one portal for deployments, alerts, and billing.","Quite the little portal.","So if it goes down, do we all get the afternoon off?","I'll keep the old bookmarks. 🙂","Let's start with just the dashboards."
  ]:["有个提议：部署、告警、账单，都放进同一个门户。","听起来挺省事。","那它要是挂了，我们是不是都能放半天假？","旧书签我先留着。🙂","要不先只整合仪表盘吧。"]);
  expect(room.messages.filter((m:{attachment?:unknown})=>m.attachment)).toHaveLength(2);
  const gif=room.messages.find((m:{attachment?:{category:string}})=>m.attachment?.category==="gif");
  const metadata=await sharp(Buffer.from(gif.attachment.dataUrl.split(",")[1],"base64"),{animated:true}).metadata();
  expect(metadata.pages).toBe(12);expect(metadata.delay).toEqual(Array(12).fill(100));
  expect(inputs).toHaveLength(0);expect(app.memeCounters.metadataRequests).toBe(0);
  await expect(page.getByTestId("chat-message")).toHaveCount(5);
  await expect(page.locator(".local-messages").getByRole("note")).toHaveCount(2);
  await expect(page.locator(".local-messages").getByRole("note").first()).toContainText(t("Synthetic test fixture","合成测试占位素材"));
  expect(await page.locator(".local-messages").innerText()).not.toMatch(/illustration|pan\/zoom|预备|插画|未新增|not native/iu);
  const reference=await readFile(resolve("assets","chat-demo","film-reference.png"));
  expect(Buffer.from(room.messages[1].attachment.dataUrl.split(",")[1],"base64")).toEqual(reference);
  expect(room.messages[1].demoMedia).toBe("user-reference");expect(room.messages[2].demoMedia).toBe("local-motion");
  await expect(page.getByTestId("chat-message").nth(1).getByAltText(t("Shared image","分享的图片"))).toBeVisible();
  expect(await page.locator(".local-messages").innerText()).not.toMatch(/rights unverified|底层素材权利|Gandalf|sarcasm/iu);
  const trigger=page.getByTestId("chat-message").nth(1).getByRole("button",{name:t("Message actions","消息操作"),exact:true});
  await trigger.click();await page.getByRole("menuitem",{name:t("Media information","素材信息"),exact:true}).click();
  await expect(page.getByRole("dialog",{name:t("Media information","素材信息"),exact:true})).toContainText(t("Synthetic geometric publication fixture","发布版几何测试占位图"));
  await expect(page.getByRole("dialog",{name:t("Media information","素材信息"),exact:true})).toContainText(t("not a film frame","非电影画面"));
  await page.keyboard.press("Escape");await expect(trigger).toBeFocused();
  expect(inputs).toHaveLength(0);
  const rejected=await api(page,"demo",{language:"en"});expect(rejected.status).toBe(400);
  expect((await api(page,"state")).value.messages).toEqual(room.messages);
  for(const index of [1,2,3]){
    const processed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/process");
    await page.getByTestId("chat-message").nth(index).getByRole("button",{name:t("Explain","解释一下"),exact:true}).click();
    const response=await processed;expect(response.status()).toBe(200);
    const explanation=(await response.json()).result.explanation;
    expect(explanation.background).toEqual({source:null,context:null,frames:[]});
    expect(explanation.contextualInterpretations[0].context).toEqual(room.messages.map((m:{id:string})=>m.id));
    await expect(page.locator(".explanation-brief")).toHaveText(t("Possible meaning here: ","此处可能含义：")+"Synthetic context only");
    if(index===3)await expect(page.locator(".explanation-details")).not.toHaveAttribute("open");
    else await expect(page.locator(".explanation-background")).toContainText(t("cannot be identified confidently","无法从所选图片或表情可靠识别出处"));
    await expect(page.getByText("Fixture illustration",{exact:true})).not.toBeVisible();
    expect(inputs.at(-1)!.frames).toHaveLength(index===1?1:index===2?2:0);
    expect(inputs.at(-1)!.context).toEqual(room.messages.map((m:{text:string;speaker:string},i:number)=>({label:`c${i}`,text:`${m.speaker}: ${m.text}`})));
    expect(inputs.at(-1)!.speakerContext).toMatchObject({role:"selected-sender",profile:null});
    expect(JSON.stringify(inputs.at(-1))).not.toMatch(/user-reference|film meme|Gandalf|sarcasm/iu);
    if(index===1){
      const actual=Buffer.from(imageUrls.at(-1)![0].split(",")[1],"base64");
      expect(await sharp(actual).ensureAlpha().raw().toBuffer()).toEqual(await sharp(reference).ensureAlpha().raw().toBuffer());
      expect(inputs.at(-1)!.target).toEqual({kind:"visual"});
    }
    if(index===3){expect(imageUrls.at(-1)).toHaveLength(0);expect(inputs.at(-1)!.target).toEqual({kind:"emoji",emoji:"🙂"});}
  }
  expect(inputs).toHaveLength(3);
});
test("demo owner reset during normalization leaves no partial messages and can deliberately retry",async({page})=>{
  await open(page);
  const pending=api(page,"demo",{language:"en"});
  await expect.poll(()=>app.resources().nativeBusy,{intervals:[5]}).toBe(true);
  await api(page,"reset");await pending;
  expect((await api(page,"state")).value.messages).toHaveLength(0);
  expect((await api(page,"demo",{language:"en"})).status).toBe(200);
  expect((await api(page,"state")).value.messages).toHaveLength(5);
  expect(inputs).toHaveLength(0);
});
