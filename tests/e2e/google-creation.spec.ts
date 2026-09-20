import {expect,test,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {serpResponse} from "../../src/server/serpapi.test.support";
import {openCreate,openCreationOptions} from "../expression-ui";
import {offlineDraft} from "../../src/server/generation.test.support";
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,pixels:Buffer;
let source:{url:string;init?:RequestInit}[],images:string[],plans:string[],ranks:string[],fault:string,hold:boolean,release:(()=>void)|undefined;
test.beforeEach(async({},info)=>{
  source=[];images=[];plans=[];ranks=[];fault="";hold=false;release=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  pixels=await sharp({create:{width:300,height:300,channels:3,background:"#256"}}).jpeg().toBuffer();
  const generated=await sharp({create:{width:1024,height:1024,channels:3,background:"#845"}}).png().toBuffer();
  app=await createLocalChatServer("OFFLINE-MODEL",{clientRoot:resolve(root,"client"),interaction:"direct-personal",creationChoices:true,mixedCreation:true,webCreation:true,
    webProvider:"serpapi",webSearchKey:info.title.includes("missing key")?undefined:"OFFLINE-SERP",cooldownMs:info.title.includes("local pacing")?150:0,catalogSource:"original-demo",
    memeTransport:async()=>{throw new Error("No alternative provider fallback");},
    webSearchTransport:async(url,init)=>{
      source.push({url:String(url),init});
      if(new URL(String(url)).pathname!=="/search"){
        if(fault==="redirect")return new Response("",{status:302,headers:{Location:"http://127.0.0.1/private"}});
        if(fault==="html-thumbnail")return new Response("<html>Not an image</html>",{headers:{"Content-Type":"text/html"}});
        if(fault==="mismatched-thumbnail")return new Response(new Uint8Array(pixels),{headers:{"Content-Type":"image/png"}});
        if(fault==="oversized-thumbnail")return new Response(new Uint8Array(1024*1024+1),{headers:{"Content-Type":"image/jpeg"}});
        return new Response(new Uint8Array(pixels),{headers:{"Content-Type":"image/jpeg"}});
      }
      if(fault==="outage"||fault==="429"||fault==="auth")return new Response("",{status:fault==="outage"?503:fault==="429"?429:401});
      const data=serpResponse();
      if(info.title.includes("semantic query")||["redirect","html-thumbnail","mismatched-thumbnail","oversized-thumbnail"].includes(fault)){
        data.images_results.forEach((row,i)=>{row.thumbnail=`https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9Gc_fixture${i}&s`;});
      }
      if(fault==="empty")data.images_results=[];
      if(fault==="unsafe")data.images_results[0].thumbnail="http://127.0.0.1/private";
      return Response.json(data);
    },
    transport:async(_url,init)=>{
      const body=String(init?.body),parsed=JSON.parse(body),input=JSON.parse(parsed.messages[1].content[0].text);
      expect(parsed.response_format.json_schema.strict).toBe(true);
      if(input.task==="plan-public-image-query"){
        plans.push(body);
        if(hold)await new Promise<void>(resolve=>{release=resolve;});
        const value={emotion:fault==="badplan"?"PRIVATE-PROJECT":"relieved",situation:"reaction",medium:"movie",
          publicReference:input.allowPublicReferences?"Gandalf":null};
        return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]});
      }
      ranks.push(body);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({id:fault==="nomatch"?null:input.catalog[1].id,reason:"Fits the expression."})}}]});
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
    .fill(language==="en"?"PRIVATE-Project8811 launch succeeded; finally relieved":"私密项目8811上线成功，终于松口气");
}
for(const language of ["en","zh-CN"] as const)test(`Google semantic query and exact source/caption work in ${language}`,async({page})=>{
  const t=(en:string,zh:string)=>language==="en"?en:zh;await open(page,language);
  expect(source.length+plans.length+ranks.length+images.length).toBe(0);
  await page.getByRole("button",{name:t("Create 3 options","创建 3 个方案"),exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText(t("3 of 3 ready","3 个方案中已有 3 个就绪"));
  expect(plans).toHaveLength(1);expect(ranks).toHaveLength(1);expect(images).toHaveLength(2);expect(source).toHaveLength(2);
  expect(new URL(source[0].url).searchParams.get("q")).toBe("relieved reaction movie");
  expect(new URL(source[0].url).searchParams.get("api_key")).toBe("OFFLINE-SERP");
  expect(source[1].url).toBe("https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9Gc_fixture1&s");
  expect(JSON.stringify(source[1])).not.toContain("OFFLINE-SERP");expect(source[1].init?.headers).toEqual({Accept:"image/png,image/jpeg"});
  expect(JSON.stringify(source)).not.toMatch(/PRIVATE|私密|8811/);
  const card=page.locator(".existing-candidate");
  expect(await(await page.request.get(origin+await card.locator("img").getAttribute("src"))).body()).toEqual(await sharp(pixels).png().toBuffer());
  await card.getByRole("button",{name:t("Use web preview + caption","使用网络预览图与配文"),exact:true}).click();
  await page.getByLabel(t("Caption beside image","图片旁的配文"),{exact:true}).fill(t("Finally!","终于完成！"));
  await page.getByRole("button",{name:t("Preview web image + caption","预览网络图片与配文"),exact:true}).click();
  await page.getByRole("button",{name:t("Insert web preview + caption locally","将网络预览图与配文插入本地"),exact:true}).click();
  await expect(page.getByTestId("chat-message")).toContainText(t("Finally!","终于完成！"));
  const message=(await api(page,"state")).value.messages[0];
  expect(message.visual.webSource).toMatchObject({provider:"Google Images via SerpApi",query:"relieved reaction movie"});
  expect(message.visual.webSource.attribution).toBeUndefined();expect(message.generated).toBeUndefined();
  expect(JSON.stringify(message)).not.toContain("OFFLINE-SERP");expect(message.visual.notices.license).toContain("does not grant");
  expect(images[0]).not.toBe(images[1]);
});
for(const language of ["en","zh-CN"] as const)test(`downloaded preview preserves640px and can be inspected without inference in ${language}`,async({page})=>{
  pixels=await sharp({create:{width:640,height:480,channels:3,background:"#478"}}).jpeg().toBuffer();
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  await open(page,language);await page.getByRole("button",{name:t("Create 3 options","创建 3 个方案"),exact:true}).click();
  const card=page.locator(".existing-candidate");await expect(page.locator(".generation-batch")).toContainText(t("3 of 3 ready","3 个方案中已有 3 个就绪"));
  const bytes=await(await page.request.get(origin+await card.locator("img").getAttribute("src"))).body();
  expect(await sharp(bytes).metadata()).toMatchObject({width:640,height:480});
  expect(await sharp(bytes).raw().toBuffer()).toEqual(await sharp(pixels).raw().toBuffer());
  const counts=[source.length,plans.length,ranks.length,images.length];
  const button=card.getByRole("button",{name:t("Inspect downloaded pixels","查看下载图像素"),exact:true});
  await button.click();
  const dialog=page.getByRole("dialog",{name:t("Downloaded image preview","下载图片预览"),exact:true});
  await expect(dialog).toBeVisible();expect((await dialog.locator("img").boundingBox())!.width).toBe(640);
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(button).toBeFocused();
  expect([source.length,plans.length,ranks.length,images.length]).toEqual(counts);
});
test("small thumbnails never stretch on high-density desktop or mobile",async({browser})=>{
  pixels=await sharp({create:{width:160,height:90,channels:3,background:"#487"}}).jpeg().toBuffer();
  const context=await browser.newContext({deviceScaleFactor:2}),page=await context.newPage();
  try{
    await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
    await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
    const card=page.locator(".existing-candidate");
    await expect(card).toContainText("Small thumbnail");
    expect((await card.locator("img").boundingBox())!.width).toBe(80);
    expect((await card.locator("img").boundingBox())!.height).toBe(45);
    await card.getByRole("button",{name:"Inspect downloaded pixels",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Downloaded image preview",exact:true});
    await expect(dialog).toBeVisible();
    expect((await dialog.locator("img").boundingBox())!.width).toBe(80);
    expect((await dialog.locator("img").boundingBox())!.height).toBe(45);
    await page.setViewportSize({width:320,height:800});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await dialog.getByRole("button",{name:"Close",exact:true}).click();
    expect(images).toHaveLength(2);expect(plans).toHaveLength(1);expect(source).toHaveLength(2);
  }finally{await context.close();}
});
test("larger preview respects existing one-MiB decoded-output budget with explicit reduction",async({page})=>{
  const raw=Buffer.alloc(1024*1024*3);let seed=12345;
  for(let i=0;i<raw.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;raw[i]=seed&255;}
  pixels=await sharp(raw,{raw:{width:1024,height:1024,channels:3}}).jpeg({quality:75}).toBuffer();
  expect(pixels.length).toBeLessThan(1024*1024);
  await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
  const card=page.locator(".existing-candidate");
  await expect(card).toContainText("Reduced locally");
  const bytes=await(await page.request.get(origin+await card.locator("img").getAttribute("src"))).body();
  expect(await sharp(bytes).metadata()).toMatchObject({width:512,height:512});
  expect(bytes.length).toBeLessThan(1024*1024);
  await card.getByRole("button",{name:"Inspect downloaded pixels",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Downloaded image preview"})).toContainText("1024×1024 / 512×512");
});
test("preview clarity does not bypass native dimension limits or block independent AI",async({page})=>{
  pixels=await sharp({create:{width:5000,height:1,channels:3,background:"#487"}}).jpeg().toBuffer();
  await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  expect(images).toHaveLength(2);expect(source).toHaveLength(2);
  await expect(page.locator(".existing-candidate img")).toHaveCount(0);
});
test("missing key performs no planning or search, two images proceed and source-only retry adds no image",async({page})=>{
  await open(page);await expect(page.getByText("Configure Google Images via SerpApi",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  expect(plans.length+ranks.length+source.length).toBe(0);expect(images).toHaveLength(2);
  await page.getByRole("button",{name:"Retry image search",exact:true}).click();
  await expect(page.getByRole("button",{name:"Retry image search",exact:true})).toBeEnabled();
  expect(images).toHaveLength(2);expect(source).toHaveLength(0);
  for(const width of [320,556]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
});
for(const mode of ["outage","429","auth","empty","unsafe","nomatch","redirect","badplan","html-thumbnail","mismatched-thumbnail","oversized-thumbnail"])test(`Google ${mode} leaves independent AI options usable`,async({page})=>{
  fault=mode;await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  expect(images).toHaveLength(2);expect(plans).toHaveLength(1);
  expect(source).toHaveLength(mode==="badplan"?0:mode==="redirect"||mode.endsWith("-thumbnail")?2:1);
  expect(images.every(body=>!body.includes("publicTextInspiration"))).toBe(true);
  expect(app.memeCounters.metadataRequests).toBe(0);
});
test("source-only retry reuses the exact planned query without another planner or image request",async({page})=>{
  fault="outage";await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  await expect(page.locator(".local-generation")).toContainText("relieved reaction movie");
  fault="";await page.getByRole("button",{name:"Retry image search",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
  expect(plans).toHaveLength(1);expect(images).toHaveLength(2);expect(ranks).toHaveLength(1);
  expect(new URL(source[0].url).searchParams.get("q")).toBe(new URL(source[1].url).searchParams.get("q"));
});
test("manual public query bypasses planner; opted-in movie names are preserved; local pacing supports both text tasks",async({page})=>{
  await open(page);await openCreationOptions(page);
  await page.getByLabel("Web search terms",{exact:true}).fill("Gandalf relieved reaction");
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
  expect(plans).toHaveLength(0);expect(new URL(source[0].url).searchParams.get("q")).toBe("Gandalf relieved reaction");
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Gandalf is relieved");
  await page.getByLabel("Web search terms",{exact:true}).fill("");
  await page.getByRole("checkbox",{name:"Allow public film/game/fictional-character names from my description in automatic search",exact:true}).check();
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
  expect(plans).toHaveLength(1);expect(new URL(source[2].url).searchParams.get("q")).toBe("Gandalf relieved reaction movie");
});
test("editing during query planning cancels stale external and image work",async({page})=>{
  hold=true;await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect.poll(()=>plans.length).toBe(1);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Different request");
  hold=false;release?.();await expect(page.getByRole("button",{name:"Create 3 options",exact:true})).toBeEnabled();
  expect(source).toHaveLength(0);expect(images).toHaveLength(0);
});
test("planner gets intent only; ranker gets exact10 internal contexts; external search receives neither",async({page})=>{
  await page.goto(origin+"/chat");
  for(let i=0;i<12;i++)await api(page,"message",{speaker:"Alex",text:`PRIVATE-CONTEXT ${i}`});
  const state=(await api(page,"state")).value;
  const draft={...offlineDraft(),intent:"Release succeeded, relieved",preferences:{...offlineDraft().preferences,culture:"PRIVATE-PREFERENCE"},
    context:state.messages.map((m:{id:string;text:string},i:number)=>({label:m.id,text:m.text,included:i<10}))};
  const response=await api(page,"generation/batch/review",{draft,draftRevision:0,count:3,referenceMode:"popular-text"});
  expect(response.status).toBe(200);expect(plans).toHaveLength(1);expect(plans[0]).not.toMatch(/PRIVATE-CONTEXT|PRIVATE-PREFERENCE/);
  const input=JSON.parse(JSON.parse(ranks[0]).messages[1].content[0].text);
  expect(input.context).toHaveLength(10);expect(input.preferences.culture).toBe("PRIVATE-PREFERENCE");
  expect(JSON.stringify(source)).not.toMatch(/PRIVATE-CONTEXT|PRIVATE-PREFERENCE/);expect(images).toHaveLength(0);
});
