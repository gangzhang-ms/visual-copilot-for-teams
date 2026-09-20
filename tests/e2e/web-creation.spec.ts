import {expect,test,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {openCreate,openCreationOptions} from "../expression-ui";
import {offlineDraft} from "../../src/server/generation.test.support";
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(name:string)=>pathToFileURL(resolve(root,"server",name)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,proxy:Buffer;
let web:{url:string;init?:RequestInit}[],images:string[],rank:string[],failSearch:boolean,authFailure:boolean,unsafe:boolean,empty:boolean,failImage:number;
let hold:boolean,release:(()=>void)|undefined;
let explains:string[];
test.beforeEach(async({},info)=>{
  web=[];images=[];rank=[];explains=[];failSearch=false;authFailure=false;unsafe=false;empty=false;failImage=0;hold=false;release=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));
  expect(localPaidLease.busy).toBe(false);localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const svg=(size:number,color:string)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#dec"/><circle cx="${size/3}" cy="${size/2}" r="${size/4}" fill="${color}"/></svg>`);
  proxy=await sharp(svg(300,"#276")).jpeg().toBuffer();
  const generated=await sharp(svg(1024,"#724")).png().toBuffer();
  app=await createLocalChatServer("OFFLINE-MODEL",{clientRoot:resolve(root,"client"),interaction:"direct-personal",creationChoices:true,mixedCreation:true,
    webCreation:true,webProvider:"brave",webSearchKey:info.title.includes("missing credential")?undefined:"OFFLINE-BRAVE",cooldownMs:0,catalogSource:"original-demo",
    memeTransport:async()=>{throw new Error("Imgflip fallback forbidden");},
    webSearchTransport:async(url,init)=>{
      web.push({url:String(url),init});
      if(hold)await new Promise<void>(resolve=>{release=resolve;});
      if(failSearch)return new Response("",{status:503});
      if(authFailure)return new Response("",{status:403});
      if(String(url).startsWith("https://imgs.search.brave.com/"))return new Response(new Uint8Array(proxy),{headers:{"Content-Type":"image/jpeg"}});
      return new Response(JSON.stringify({type:"images",query:{original:"team relief"},extra:{might_be_offensive:false},
        results:empty?[]:Array.from({length:3},(_,i)=>({type:"image_result",title:`Web reaction ${i}`,url:`https://example.com/page${i}`,
          thumbnail:{src:unsafe?"http://127.0.0.1/private":`https://imgs.search.brave.com/p${i}.jpg`},
          properties:{url:`https://original.example.com/full${i}.jpg`}}))}),{headers:{"Content-Type":"application/json"}});
    },
    transport:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)),input=JSON.parse(body.messages[1].content[0].text);
      if(input.frames){
        explains.push(String(init?.body));
        return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          background:{source:"Offline source fixture",context:"Offline source context, not common usage.",frames:input.frames.map((f:{id:string})=>f.id)},
          observations:[{text:"A circle on a pale square.",frames:input.frames.map((f:{id:string})=>f.id)}],
          commonUsage:["An illustrative visual."],contextualInterpretations:[{text:"A possible fictional reaction.",context:input.context.map((c:{label:string})=>c.label)}],
          uncertainties:["Sender intent is unknown."],safeResponseGuidance:["Ask for clarification."]
        })}}]});
      }
      rank.push(String(init?.body));
      expect(body.response_format.json_schema.strict).toBe(true);expect(input.catalog).toHaveLength(3);
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({id:input.catalog[1].id,reason:"Fits the expression."})}}]}),{headers:{"Content-Type":"application/json"}});
    },
    generation:{...ongoingPersonalGenerationOptions(),transport:async(_url,init)=>{
      images.push(String(init?.body));
      if(images.length===failImage)return new Response("",{status:429,headers:{"retry-after":"30"}});
      return new Response(JSON.stringify({data:[{b64_json:generated.toString("base64")}]}),{headers:{"Content-Type":"application/json"}});
    }}
  });origin=await app.start(0);
});
test.afterEach(async()=>{release?.();await app.close();});
async function api(page:Page,path:string,body:object={}){
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
  await page.getByLabel(language==="en"?"What would you like to express?":"你想表达什么？",{exact:true}).fill("PRIVATE-INTENT: relief after our fictional work");
}
for(const language of ["en","zh-CN"] as const)test(`web preview and caption are owned, not generated, with minimal query and no credential on preview in ${language}`,async({page})=>{
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  await open(page,language);await openCreationOptions(page);
  await expect(page.getByText(t("Find uses the selected asset library. Create uses Brave web image search when configured.","推荐现成图使用所选素材库；创作模式在配置后使用 Brave 网络图片搜索。"),{exact:true})).toBeVisible();
  await page.getByLabel(t("Web search terms","网络搜索词"),{exact:true}).fill("team relief");
  await page.locator(".creation-advanced > summary").click();
  expect(web.length+images.length+rank.length).toBe(0);
  await page.getByRole("button",{name:t("Create 3 options","创建 3 个方案"),exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText(t("3 of 3 ready","3 个方案中已有 3 个就绪"));
  expect(web).toHaveLength(2);expect(rank).toHaveLength(1);expect(images).toHaveLength(2);
  expect(new URL(web[0].url).searchParams.get("q")).toBe("team relief");
  expect(JSON.stringify(web)).not.toContain("PRIVATE-INTENT");
  expect(web[0].init?.headers).toMatchObject({"X-Subscription-Token":"OFFLINE-BRAVE"});
  expect(web[1].url).toBe("https://imgs.search.brave.com/p1.jpg");
  expect(web[1].init?.headers).toEqual({Accept:"image/png,image/jpeg"});
  expect(web.every(r=>r.init?.redirect==="error"&&r.init?.body===undefined)).toBe(true);
  expect(web.some(r=>r.url.includes("original.example.com"))).toBe(false);
  expect(app.memeCounters.metadataRequests).toBe(0);
  for(const body of images){const data=JSON.parse(JSON.parse(body).prompt.split("\n").at(-1));expect(data.publicTextInspiration).toMatchObject({provider:"Brave",mode:"web-text"});}
  const card=page.locator(".existing-candidate"),imageUrl=await card.locator("img").getAttribute("src");
  expect(await(await page.request.get(origin+imageUrl)).body()).toEqual(await sharp(proxy).rotate().resize({width:512,height:512,fit:"inside",withoutEnlargement:true}).png().toBuffer());
  await card.getByRole("button",{name:t("Use web preview + caption","使用网络预览图与配文"),exact:true}).click();
  await page.getByLabel(t("Caption beside image","图片旁的配文"),{exact:true}).fill("We did it!");
  await page.getByRole("button",{name:t("Preview web image + caption","预览网络图片与配文"),exact:true}).click();
  await page.getByRole("button",{name:t("Insert web preview + caption locally","将网络预览图与配文插入本地"),exact:true}).click();
  const state=(await api(page,"state")).value,message=state.messages[0];
  expect(message).toMatchObject({text:"We did it!",visual:{webSource:{provider:"Brave",kind:"web-image-preview",query:"team relief"}}});
  expect(message.generated).toBeUndefined();expect(message.visual.template).toBeUndefined();
  const review=await api(page,"review",{command:"explainVisual",selectedId:message.id,input:{intent:"",context:[],preferences:{
    source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}}});
  expect(review.status).toBe(200);expect(review.value.media.samples.length).toBeGreaterThan(0);expect(web).toHaveLength(2);
  const row=page.getByTestId("chat-message").first();
  await row.locator(".visual-enlargement > summary").click();
  expect(explains).toHaveLength(0);
  const inline=row.locator(".inline-emoji-explanation");
  await expect(row.locator(".message-visual .web-preview-quality").first()).toBeVisible();
  const resultWait=page.waitForResponse(r=>r.url().endsWith("/local/process"));
  await inline.getByRole("button",{name:t("Explain with AI","AI解释"),exact:true}).click();
  const processResponse=await resultWait;expect(processResponse.status()).toBe(200);
  const explanation=(await processResponse.json()).result.explanation;
  await expect(inline.locator(".inline-emoji-result .explanation-source")).toContainText("Offline source fixture");
  await inline.getByRole("button",{name:t("Details","详情"),exact:true}).click();
  await expect(inline.locator(".inline-explanation-details")).toContainText("Ask for clarification.");
  expect(explains).toHaveLength(1);expect(web).toHaveLength(2);expect(images).toHaveLength(2);
  const explainBody=JSON.parse(explains[0]),input=JSON.parse(explainBody.messages[1].content[0].text);
  expect(input.context).toEqual([expect.objectContaining({label:"c0",text:"Alex: We did it!"})]);
  expect(review.value.media.samples[0].assetId).toBe(message.id);
  const sentPixels=await sharp(Buffer.from(explainBody.messages[1].content[1].image_url.url.split(",")[1],"base64")).ensureAlpha().raw().toBuffer();
  const ownedPixels=await sharp(proxy).rotate().resize({width:128,height:128,fit:"inside",withoutEnlargement:true}).ensureAlpha().raw().toBuffer();
  expect(sentPixels.equals(ownedPixels)).toBe(true);
  expect(explainBody.messages[1].content[1].image_url.url).toBe(review.value.media.samples[0].dataUrl);
  expect(explanation.contextualInterpretations[0].context).toEqual([message.id]);
  const dir=resolve(".local","visual-context","visual-inline-offline");await mkdir(dir,{recursive:true});
  await writeFile(resolve(dir,`web-${language}.json`),JSON.stringify({fixtureOnly:true,paidCalls:0,selectedId:message.id,request:explainBody,explanation,ownedPixelsMatched:true,analysisSize:128},null,2));
  await row.screenshot({path:resolve(dir,`web-${language}-fixture.png`)});
});
test("missing credential still completes exactly two images and source retry never creates another image",async({page})=>{
  await open(page);
  await expect(page.getByText("Configure web image search",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  await expect(page.locator(".existing-candidate")).toContainText("Web image search is not configured");
  expect(images).toHaveLength(2);expect(web).toHaveLength(0);expect(rank).toHaveLength(0);
  await page.getByRole("button",{name:"Retry image search",exact:true}).click();
  await expect(page.getByRole("button",{name:"Retry image search",exact:true})).toBeEnabled();
  expect(images).toHaveLength(2);expect(web).toHaveLength(0);expect(app.memeCounters.metadataRequests).toBe(0);
  for(const width of [320,556]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:resolve(".local","visual-context",`web-unconfigured-${width}-mock.png`)});}
});
for(const fault of ["outage","empty","unsafe","auth"] as const)test(`web ${fault} does not block independent AI output or fall back to Imgflip`,async({page})=>{
  failSearch=fault==="outage";empty=fault==="empty";unsafe=fault==="unsafe";authFailure=fault==="auth";
  await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  expect(images).toHaveLength(2);expect(rank).toHaveLength(0);expect(web).toHaveLength(1);
  expect(app.memeCounters.metadataRequests).toBe(0);expect(images.every(body=>!body.includes("publicTextInspiration"))).toBe(true);
  if(authFailure)await expect(page.getByText("Configure web image search",{exact:true})).toBeVisible();
});
test("source-only recovery keeps images and image429 retry keeps the selected web preview",async({page})=>{
  failSearch=true;failImage=2;await open(page);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/batch/review");
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();const review=await(await response).json();
  const retry=page.getByRole("button",{name:"Retry unfinished AI options",exact:true});
  await expect(retry).toBeVisible();await expect(retry).toBeDisabled();
  const saved=(await api(page,"generation/batch/status",{batchId:review.batchId})).value.candidates[0].operation.image.assetId;
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.providerNextAt=0;localPaidLease.nextAt=0;
  await expect(retry).toBeEnabled();await retry.click();await expect(page.locator(".generation-batch")).toContainText("2 of 3 ready");
  failSearch=false;await page.getByRole("button",{name:"Retry image search",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
  expect(images).toHaveLength(3);expect((await api(page,"generation/batch/status",{batchId:review.batchId})).value.candidates[0].operation.image.assetId).toBe(saved);
});
test("query edit cancels held search before ranking, download or image generation",async({page})=>{
  hold=true;await open(page);await openCreationOptions(page);
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();await expect.poll(()=>web.length).toBe(1);
  await page.getByLabel("Web search terms",{exact:true}).fill("different terms");hold=false;release?.();
  await expect(page.getByRole("button",{name:"Create 3 options",exact:true})).toBeEnabled();
  expect(rank).toHaveLength(0);expect(images).toHaveLength(0);expect(web).toHaveLength(1);
});
test("single output is description-only and never uses an implicit Imgflip fallback",async({page})=>{
  await page.goto(origin+"/chat");
  const reviewed=await api(page,"generation/batch/review",{draft:offlineDraft(),draftRevision:0,count:1,referenceMode:"popular-text"});
  expect(reviewed.status).toBe(200);
  const {batchId,digest}=reviewed.value;await api(page,"generation/batch/process",{batchId,digest,attempt:0,consent:true});
  await expect.poll(async()=>(await api(page,"generation/batch/status",{batchId})).value.status).toBe("ready");
  expect(images).toHaveLength(1);expect(web).toHaveLength(0);expect(rank).toHaveLength(0);expect(app.memeCounters.metadataRequests).toBe(0);
});
test("ten reviewed contexts and private preferences go only to Azure, never into web search",async({page})=>{
  await page.goto(origin+"/chat");
  for(let i=0;i<12;i++)await api(page,"message",{speaker:"Alex",text:`PRIVATE-CONTEXT ${i}`});
  const state=(await api(page,"state")).value;
  const draft={...offlineDraft(),intent:"PRIVATE-INTENT: express team relief",searchTerms:"team relief",
    context:state.messages.map((m:{id:string;text:string},i:number)=>({label:m.id,text:i<10?m.text:"EXCLUDED-ROW",included:i<10})),
    preferences:{...offlineDraft().preferences,culture:"PRIVATE-PREFERENCE"}};
  const response=await api(page,"generation/batch/review",{draft,draftRevision:0,count:3,referenceMode:"popular-text"});
  expect(response.status).toBe(200);expect(rank).toHaveLength(1);
  const input=JSON.parse(JSON.parse(rank[0]).messages[1].content[0].text);
  expect(input.context).toHaveLength(10);expect(input.preferences.culture).toBe("PRIVATE-PREFERENCE");
  expect(rank[0]).not.toContain("EXCLUDED-ROW");
  expect(JSON.stringify(web)).not.toMatch(/PRIVATE-|EXCLUDED-ROW/);
  expect(new URL(web[0].url).searchParams.get("q")).toBe("team relief");expect(images).toHaveLength(0);
});
