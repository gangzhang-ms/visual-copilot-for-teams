import {expect,test,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {commonsPage,commonsResponse} from "../../src/server/commons.test.support";
import {openCreate,openCreationOptions} from "../expression-ui";
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,preview:Buffer;
let source:{url:string;init?:RequestInit}[],images:string[],selections:string[],fault:string,hold:boolean,release:(()=>void)|undefined;
test.beforeEach(async()=>{
  source=[];images=[];selections=[];fault="";hold=false;release=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  preview=await sharp({create:{width:300,height:300,channels:3,background:"#257"}}).jpeg().toBuffer();
  const generated=await sharp({create:{width:1024,height:1024,channels:3,background:"#754"}}).png().toBuffer();
  app=await createLocalChatServer("OFFLINE-MODEL",{clientRoot:resolve(root,"client"),interaction:"direct-personal",creationChoices:true,mixedCreation:true,webCreation:true,
    cooldownMs:0,catalogSource:"original-demo",memeTransport:async()=>{throw new Error("No Imgflip fallback");},
    webSearchTransport:async(url,init)=>{
      source.push({url:String(url),init});
      if(hold)await new Promise<void>(resolve=>{release=resolve;});
      if(fault==="outage"||fault==="429")return new Response("",{status:fault==="429"?429:503,headers:{"Retry-After":"20"}});
      if(String(url).startsWith("https://upload.wikimedia.org/")){
        if(fault==="redirect")return new Response("",{status:302,headers:{Location:"http://127.0.0.1/private"}});
        return new Response(new Uint8Array(preview),{headers:{"Content-Type":"image/jpeg"}});
      }
      const data=commonsResponse();
      if(fault==="empty")data.query.pages=[];
      if(fault==="unsafe")data.query.pages[0].imageinfo[0].thumburl="http://127.0.0.1/private";
      if(fault==="unlicensed")for(const page of data.query.pages)page.imageinfo[0].extmetadata.LicenseShortName.value="All rights reserved";
      return Response.json(data);
    },
    transport:async(_url,init)=>{
      selections.push(String(init?.body));const body=JSON.parse(String(init?.body)),input=JSON.parse(body.messages[1].content[0].text);
      expect(body.response_format.json_schema.strict).toBe(true);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({id:fault==="nomatch"?null:input.catalog[1].id,reason:"Matches the reviewed intent."})}}]});
    },
    generation:{...ongoingPersonalGenerationOptions(),transport:async(_url,init)=>{
      images.push(String(init?.body));return Response.json({data:[{b64_json:generated.toString("base64")}]});
    }}
  });origin=await app.start(0);
});
test.afterEach(async()=>{release?.();await app.close();});
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const state=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const r=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":state.csrf},
      body:JSON.stringify(path==="state"?body:{revision:state.revision,...body})});
    return {status:r.status,value:await r.json()};
  },{path,body});
}
async function open(page:Page,language:"en"|"zh-CN"="en"){
  await page.setViewportSize({width:1440,height:950});await page.goto(origin+"/chat");
  if(language!=="en")await page.getByLabel("Language / 语言").selectOption(language);
  await openCreate(page,language,false);
  await page.getByLabel(language==="en"?"What would you like to express?":"你想表达什么？",{exact:true})
    .fill(language==="en"?"PRIVATE: take a coffee break after finishing the work":"私密：忙完工作，一起喝杯咖啡休息");
  await openCreationOptions(page);
  await page.getByLabel(language==="en"?"Web search terms":"网络搜索词",{exact:true}).fill(language==="en"?"coffee cup":"咖啡 杯子");
  await page.locator(".creation-advanced > summary").click();
}
for(const language of ["en","zh-CN"] as const)test(`Commons source, attribution and editable caption survive insertion in ${language}`,async({page})=>{
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  await open(page,language);
  expect((await(await page.request.get(origin+"/healthz")).json()).webImageSearch)
    .toEqual({provider:"Wikimedia Commons",configured:true,keyRequired:false,scope:"configuration-only"});
  await expect(page.locator(".web-search-setup")).toHaveCount(0);
  expect(source.length+images.length+selections.length).toBe(0);
  await page.getByRole("button",{name:t("Create 3 options","创建 3 个方案"),exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText(t("3 of 3 ready","3 个方案中已有 3 个就绪"));
  const card=page.locator(".existing-candidate");
  await expect(card.getByRole("heading",{name:t("Wikimedia image + caption","维基图片配文"),exact:true})).toBeVisible();
  expect(source).toHaveLength(2);expect(selections).toHaveLength(1);expect(images).toHaveLength(2);
  expect(JSON.stringify(source)).not.toMatch(/PRIVATE|私密|Subscription|api.key/);
  expect(new URL(source[0].url).searchParams.get("gsrsearch")).toBe(language==="en"?"coffee cup":"咖啡 杯子");
  expect(source[1].url).toContain("Coffee_cup_1.jpg");
  expect(source.every(r=>r.init?.redirect==="error"&&r.init?.body===undefined)).toBe(true);
  for(const body of images)expect(JSON.parse(JSON.parse(body).prompt.split("\n").at(-1)).publicTextInspiration.provider).toBe("Wikimedia Commons");
  expect(images[0]).not.toBe(images[1]);
  const path=await card.locator("img").getAttribute("src");
  expect(await(await page.request.get(origin+path)).body()).toEqual(await sharp(preview).png().toBuffer());
  await card.getByRole("button",{name:t("Use web preview + caption","使用网络预览图与配文"),exact:true}).click();
  await page.getByLabel(t("Caption beside image","图片旁的配文"),{exact:true}).fill(t("Coffee break!","喝杯咖啡吧！"));
  await page.getByRole("button",{name:t("Preview web image + caption","预览网络图片与配文"),exact:true}).click();
  await page.getByRole("button",{name:t("Insert web preview + caption locally","将网络预览图与配文插入本地"),exact:true}).click();
  await expect(page.getByTestId("chat-message")).toContainText(t("Coffee break!","喝杯咖啡吧！"));
  const state=(await api(page,"state")).value,m=state.messages[0];
  expect(m.generated).toBeUndefined();
  expect(m.visual.webSource.attribution).toMatchObject({artist:"Casey & Robin",license:"CC BY-SA 4.0",credit:"Own work"});
  expect(JSON.stringify(m.visual)).not.toMatch(/<script>|<a href|<b>/);
  expect(m.visual.notices.links).toContainEqual({label:"License",url:"https://creativecommons.org/licenses/by-sa/4.0/"});
  const review=await api(page,"review",{command:"explainVisual",selectedId:m.id,input:{intent:"",context:[],preferences:{
    source:"requester-reported",confirmed:true,outputLanguage:language,familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}}});
  expect(review.status).toBe(200);expect(review.value.media.samples).toHaveLength(1);expect(source).toHaveLength(2);
  for(const width of [320,556]){
    await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});
for(const mode of ["empty","outage","429","unsafe","unlicensed","nomatch","redirect"])test(`Commons ${mode} fails only the source card and permits two AI outputs`,async({page})=>{
  fault=mode;await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  expect(images).toHaveLength(2);
  expect(images.every(body=>!body.includes("publicTextInspiration"))).toBe(true);
  expect(app.memeCounters.metadataRequests).toBe(0);
  expect(source).toHaveLength(mode==="redirect"?2:1);
  expect(selections).toHaveLength(["nomatch","redirect"].includes(mode)?1:0);
});
test("retrying Commons alone adds no image call and pending edits cancel all further work",async({page})=>{
  fault="outage";await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  fault="";await page.getByRole("button",{name:"Retry image search",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");expect(images).toHaveLength(2);
  expect(source).toHaveLength(3);expect(selections).toHaveLength(1);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("A new coffee break");
  hold=true;await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect.poll(()=>source.length).toBe(4);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Changed before source arrived");
  hold=false;release?.();await expect(page.getByRole("button",{name:"Create 3 options",exact:true})).toBeEnabled();
  expect(images).toHaveLength(2);expect(selections).toHaveLength(1);
});
test("Commons snapshot normalizes a GIF first frame, retains original bytes and releases cache ownership",async()=>{
  const {CommonsImageSearch,parseCommonsImages}=await import(built("commons-image-search.js"));
  const gif=await sharp(Buffer.concat([Buffer.alloc(32*32*3,80),Buffer.alloc(32*32*3,190)]),
    {raw:{width:32,height:64,channels:3,pageHeight:32}}).gif({delay:[100,100],loop:0}).toBuffer();
  expect((await sharp(gif).metadata()).pages).toBe(2);
  const provider=new CommonsImageSearch(async()=>new Response(new Uint8Array(gif),{headers:{"Content-Type":"image/gif"}}));
  const item=parseCommonsImages({query:{pages:[commonsPage(0,"image/gif")]}})[0],s=await provider.snapshot(item,"coffee cup",new AbortController().signal);
  expect(s.read(item.id).original).toEqual(gif);expect((await sharp(s.read(item.id).preview).metadata()).format).toBe("png");
  expect(s.read(item.id).preview).toEqual(await sharp(gif).png().toBuffer());
  expect(s.assets[0].rights.approved).toBe(false);
  const releaseRef=s.retain();s.release();expect(provider.retainedBytes).toBeGreaterThan(0);releaseRef();expect(provider.retainedBytes).toBe(0);
});
