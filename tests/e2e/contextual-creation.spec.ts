import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {openCreate,waitForLocalSession} from "../expression-ui";
import {offlineDraft} from "../../src/server/generation.test.support";
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,plans:string[],ranks:string[],images:string[],queries:string[];
let fault:string,hold:boolean,release:(()=>void)|undefined;
test.beforeEach(async()=>{
  plans=[];ranks=[];images=[];queries=[];fault="";hold=false;release=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const thumb=await sharp({create:{width:256,height:256,channels:3,background:"#245"}}).jpeg().toBuffer();
  const generated=await sharp({create:{width:1024,height:1024,channels:3,background:"#587"}}).png().toBuffer();
  app=await createLocalChatServer("OFFLINE",{clientRoot:resolve(root,"client"),interaction:"direct-personal",creationChoices:true,mixedCreation:true,
    webCreation:true,contextualCreation:true,emojiExpressions:true,webProvider:"serpapi",webSearchKey:"OFFLINE",cooldownMs:0,catalogSource:"original-demo",
    memeTransport:async()=>{throw new Error("No fallback");},
    webSearchTransport:async(raw,init)=>{
      const url=new URL(String(raw));
      if(url.pathname==="/search"){
        queries.push(url.searchParams.get("q")!);
        if(fault==="outage")return new Response("",{status:503});
        return Response.json({search_metadata:{status:"Success"},images_results:[
          {title:"10-Day Burnout & Exhaustion Challenge",link:"https://example.com/ad",original:"https://example.com/ad.png",thumbnail:"https://encrypted-tbn0.gstatic.com/images?q=tbn:fixtureAd&s"},
          {title:"Gandalf exhausted reaction meme",link:"https://example.com/movie",original:"https://example.com/film.jpg",thumbnail:"https://encrypted-tbn0.gstatic.com/images?q=tbn:fixtureMovie&s"}
        ]});
      }
      expect(init?.headers).toEqual({Accept:"image/png,image/jpeg"});
      return new Response(new Uint8Array(thumb),{headers:{"Content-Type":"image/jpeg"}});
    },
    transport:async(_url,init)=>{
      const body=String(init?.body),request=JSON.parse(body),input=JSON.parse(request.messages[1].content[0].text);
      if(request.response_format?.json_schema?.schema?.required?.includes("background")){
        return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          background:{source:null,context:null,frames:[]},
          observations:[{text:"Visible fictional fixture",frames:input.frames.map((f:{id:string})=>f.id)}],
          commonUsage:["A fictional reaction"],contextualInterpretations:[{text:"Fixture explanation",context:input.context.map((c:{label:string})=>c.label)}],
          uncertainties:["Interpretation is uncertain"],safeResponseGuidance:["Ask neutrally"]
        })}}]});
      }
      if(input.task==="plan-contextual-expression"){
        plans.push(body);if(hold)await new Promise<void>(resolve=>{release=resolve;});
        const override=input.intent.includes("cats"),game=input.intent.includes("game fixture"),unknown=input.intent.includes("unknown")||fault==="owl",
          noImage=input.frames.length===0,generic=unknown||["drawn","photo","gif-photo"].includes(fault);
        const value={observedSources:input.frames.map((_:unknown,i:number)=>!generic&&i===0?(game?"Master Chief":"Gandalf"):null),mode:override?"override":noImage?"unanchored":"inherit",kind:override||generic?"motif":noImage?"none":"fictional",
          franchise:override||generic||noImage?null:game?"Halo":"The Lord of the Rings",characters:override||generic||noImage?[]:game?["Master Chief"]:["Gandalf"],
          subject:override?"cat":fault==="owl"?"owl":generic?"object":game?"hero":"wizard",reaction:"exhausted",medium:fault==="drawn"?"illustration":fault==="photo"||fault==="gif-photo"?"photo":game?"video game":unknown?"unknown":"movie",
          visualStyle:noImage||unknown&&fault!=="owl"?"unknown":fault==="owl"||fault==="drawn"?"illustrated":game?"rendered":"photographic",
          motif:override?"Two tired cats":fault==="owl"?"An exhausted owl":unknown?"A tired anonymous figure":"A weary fictional hero",subjectCount:override?2:1,
          certainty:generic?"uncertain":noImage?"none":"grounded",evidence:input.frames.length?[fault==="bad-reference"?"other-room":input.frames[0].id]:[]};
        const output=fault==="discard-fiction"?{...value,kind:"motif",franchise:null,characters:[],motif:"A tired owl"}:value;
        return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]});
      }
      ranks.push(body);
      expect(input.contextDirection).toBeTruthy();
      const ad=fault==="ad",none=fault==="no-match"||fault==="owl";
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        id:none?null:input.catalog[ad?0:1].id,reason:ad?"Topic only":"Fictional reaction matches",kind:ad?"advertisement":none?"none":"reaction-meme",
        anchorMatch:ad?"unknown":"matched",reactionMatch:!ad&&!none
      })}}]});
    },
    generation:{...ongoingPersonalGenerationOptions(),transport:async(_url,init)=>{
      images.push(String(init?.body));return Response.json({data:[{b64_json:generated.toString("base64")} ]});
    }}
  });origin=await app.start(0);
});
test.afterEach(async()=>{release?.();await app.close();});
async function api(page:Page,path:string,body:object={}){
  await waitForLocalSession(page);
  return page.evaluate(async({path,body})=>{
    const state=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const r=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":state.csrf},
      body:JSON.stringify(path==="state"?body:{revision:state.revision,...body})});
    return {status:r.status,value:await r.json()};
  },{path,body});
}
async function open(page:Page,intent="Work work",demo=true){
  await page.goto(origin+"/chat");
  if(demo){expect((await api(page,"demo",{language:"en"})).status).toBe(200);await page.reload();}
  await openCreate(page,"en",false);
  await page.getByLabel("What would you like to express?",{exact:true}).fill(intent);
}
async function generate(page:Page,count=3){
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText(`${count} of 3 ready`,{timeout:15000});
}
test("owned Gandalf and GIF pixels reach one plan and both requests retain the franchise instead of office stock",async({page})=>{
  await open(page);expect(plans.length+queries.length+images.length).toBe(0);await generate(page);
  expect(plans).toHaveLength(1);expect(ranks).toHaveLength(1);expect(images).toHaveLength(2);
  const plan=JSON.parse(plans[0]),payload=JSON.parse(plan.messages[1].content[0].text);
  expect(plan.messages[1].content.filter((c:{type:string})=>c.type==="image_url")).toHaveLength(2);
  expect(payload.context).toHaveLength(5);expect(payload.frames).toHaveLength(2);
  expect(payload.replyTo).toBeNull();
  expect(new Set(payload.frames.map((f:{context:string})=>f.context)).size).toBe(2);
  expect(new Set(plan.messages[1].content.filter((c:{type:string})=>c.type==="image_url").map((c:{image_url:{url:string}})=>c.image_url.url)).size).toBe(2);
  expect(queries[0]).toContain("Gandalf");expect(queries[0]).not.toMatch(/portal|deployments|billing/);
  for(const body of images){expect(JSON.parse(body).prompt).toContain('"characters":["Gandalf"]');expect(body).toContain("exhausted");}
  await expect(page.locator(".context-match-cue")).toContainText("The Lord of the Rings");
  await expect(page.locator(".existing-candidate")).not.toContainText("10-Day Burnout");
  await expect(page.getByRole("heading",{name:"2. AI Context-matched reaction",exact:true})).toBeVisible();
  const directory=resolve(".local","visual-context","contextual-quality-offline");
  await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,"payload-proof.json"),JSON.stringify({paidCalls:0,
    before:{plannerContext:[],plannerImageCount:0,generationAnchor:null},
    after:{planRequest:plan,publicQuery:queries[0],selectorRequest:JSON.parse(ranks[0]),generationRequests:images.map(b=>JSON.parse(b))}},null,2));
});
test("combined demo explicit film reply stays with the film, not later GIF or custom reactions",async({page})=>{
  await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  const response=await api(page,"demo",{language:"en",scenario:"combined"});expect(response.status).toBe(200);
  const state=response.value;expect(state.messages).toHaveLength(9);
  await page.reload();await openCreate(page);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Work work");
  await page.getByLabel("Visual context (optional override)",{exact:true}).selectOption(state.messages[1].id);
  expect(plans.length+queries.length+images.length).toBe(0);
  await generate(page);
  const request=JSON.parse(plans[0]),input=JSON.parse(request.messages[1].content[0].text);
  expect(input.context).toHaveLength(9);expect(input.replyTo).toBe("c2");
  expect(input.frames.length).toBeGreaterThan(0);expect(input.frames.every((f:{context:string})=>f.context==="c2")).toBe(true);
  expect(queries[0]).toContain("Gandalf");
  for(const image of images){expect(image).toContain("Gandalf");expect(image).not.toContain('"subject":"owl"');}
  expect(plans).toHaveLength(1);expect(ranks).toHaveLength(1);expect(images).toHaveLength(2);
  const directory=resolve(".local","visual-context","demo-polish-offline");await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,"express-film-binding.json"),JSON.stringify({paidCalls:0,fixtureProvider:true,
    selectedId:state.messages[1].id,planRequest:request,queries,generationRequests:images.map(value=>JSON.parse(value))},null,2));
});
for(const [name,intent,expected] of [["game","game fixture: exhausted","Master Chief"],["override","No film this time, two cats exhausted","cat"],["unknown","unknown source, tired","uncertain"]] as const){
  test(`${name} preserves coherent direction without inventing certainty`,async({page})=>{
    await open(page,intent);await generate(page);
    for(const image of images)expect(image).toContain(expected);
    if(name==="override"){expect(queries[0]).toContain("cat");expect(images.join("")).not.toContain("Gandalf");expect(images[0]).toContain('\\"subjectCount\\":2');}
    if(name==="unknown")expect(queries[0]).not.toContain("Gandalf");
  });
}
for(const intent of ["Feeling exhausted","😩"])test(`plain intent ${intent} plans without fabricated frames`,async({page})=>{
  await open(page,intent,false);await generate(page);
  const body=JSON.parse(plans[0]);expect(body.messages[1].content).toHaveLength(1);
  expect(queries[0]).toContain("reaction meme");expect(images.join("")).not.toContain("Gandalf");
});
for(const mode of ["ad","no-match"])test(`${mode} is rejected while exactly two coherent AI variants continue`,async({page})=>{
  fault=mode;await open(page);await generate(page,2);
  expect(images).toHaveLength(2);expect(images.every(b=>b.includes("Gandalf"))).toBe(true);
  await expect(page.locator(".existing-candidate")).toContainText("No matching image");
});
test("source retry reuses the same visual plan and never regenerates images",async({page})=>{
  fault="outage";await open(page);await generate(page,2);
  expect(plans).toHaveLength(1);expect(ranks).toHaveLength(0);fault="";
  await page.getByRole("button",{name:"Retry image search",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready");
  expect(plans).toHaveLength(1);expect(ranks).toHaveLength(1);expect(images).toHaveLength(2);
  expect(queries[0]).toBe(queries[1]);
});
test("invalid frame references stop before search or image dispatch",async({page})=>{
  fault="bad-reference";await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("visual context could not be matched");
  expect(queries.length+images.length+ranks.length).toBe(0);
});
test("a recognized fictional source cannot be silently replaced by a generic cutaway",async({page})=>{
  fault="discard-fiction";await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("visual context could not be matched");
  expect(queries.length+images.length+ranks.length).toBe(0);
});
test("an already selected movie message becomes the Express target without another Explain call",async({page})=>{
  await page.goto(origin+"/chat");await api(page,"demo",{language:"en"});await page.reload();
  await page.getByTestId("chat-message").filter({hasText:"Quite the little portal."}).getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".explanation-panel .explanation-brief")).toContainText("Fixture explanation");
  await openCreate(page,"en",false);await page.getByLabel("What would you like to express?",{exact:true}).fill("Work work");
  await generate(page);
  expect(plans).toHaveLength(1);expect(ranks).toHaveLength(1);
  const request=JSON.parse(plans[0]),input=JSON.parse(request.messages[1].content[0].text);
  expect(input.frames).toHaveLength(1);
  expect(input.context.find((c:{id:string})=>c.id===input.frames[0].context).text).toContain("Quite the little portal.");
});
test("editing a held visual plan cancels stale search and generation",async({page})=>{
  hold=true;await open(page);await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect.poll(()=>plans.length).toBe(1);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("New explicit direction");release?.();
  await expect(page.getByRole("button",{name:"Create 3 options",exact:true})).toBeEnabled();
  expect(queries.length+images.length+ranks.length).toBe(0);
});
test("explicit reply to the owl stays with the owl rather than inheriting an earlier movie",async({page})=>{
  fault="owl";await open(page);
  const state=(await api(page,"state")).value;
  const owl=state.messages.find((m:{text:string})=>m.text.includes("afternoon off"));
  await page.locator(".creation-advanced > summary").click();
  await page.getByLabel("Visual context (optional override)",{exact:true}).selectOption(owl.id);
  await expect(page.locator(".reply-target-cue")).toContainText("Leo");
  await generate(page,2);
  const request=JSON.parse(plans[0]),input=JSON.parse(request.messages[1].content[0].text);
  expect(input.replyTo).toBe(`c${state.messages.findIndex((m:{id:string})=>m.id===owl.id)+1}`);
  expect(input.frames.every((f:{context:string})=>f.context===input.replyTo)).toBe(true);
  expect(queries[0]).toContain("owl");
  for(const image of images){expect(image).toContain("owl");expect(image).not.toContain("Gandalf");}
});
test("unknown or excluded visual IDs are rejected before any model request",async({page})=>{
  await page.goto(origin+"/chat");await api(page,"demo",{language:"en"});
  const state=(await api(page,"state")).value;
  const draft={...offlineDraft(),intent:"Work work",visualContextId:"not-owned",
    context:state.messages.map((m:{id:string;text:string})=>({label:m.id,text:m.text,included:true}))};
  const result=await api(page,"generation/batch/review",{draft,draftRevision:0,count:3,referenceMode:"popular-text"});
  expect(result.status).not.toBe(200);expect(plans.length+queries.length+images.length).toBe(0);
});
test("explicit included visual wins over a later GIF, preserves ten contexts and treats conflicting caption as data",async({page})=>{
  await page.goto(origin+"/chat");
  expect((await api(page,"demo",{language:"en"})).status).toBe(200);
  let state=(await api(page,"state")).value;
  const film=state.messages.find((m:{demoMedia?:string})=>m.demoMedia==="user-reference");
  expect((await api(page,"edit",{id:film.id,speaker:film.speaker,text:"PRIVATE_PROJECT_771: caption claims an unrelated franchise"})).status).toBe(200);
  for(let i=0;i<5;i++)await api(page,"message",{speaker:"Maya",text:`Private fictional work item ${i}`});
  state=(await api(page,"state")).value;
  const draft={...offlineDraft(),intent:"Work work",visualContextId:film.id,
    context:state.messages.map((m:{id:string;text:string})=>({label:m.id,text:m.text,included:true}))};
  const reviewed=await api(page,"generation/batch/review",{draft,draftRevision:0,count:3,referenceMode:"popular-text"});
  expect(reviewed.status).toBe(200);
  const body=JSON.parse(plans[0]),input=JSON.parse(body.messages[1].content[0].text);
  expect(input.context).toHaveLength(10);expect(input.frames).toHaveLength(1);
  expect(input.frames[0].context).toBe(`c${draft.context.findIndex((c:{label:string})=>c.label===film.id)+1}`);
  expect(body.messages[0].content).toContain("not conflicting captions");
  expect(reviewed.value.contextPlan.characters).toEqual(["Gandalf"]);
  expect(queries[0]).not.toMatch(/PRIVATE|771|fictional work item/);expect(images).toHaveLength(0);
});
for(const scenario of [
  {name:"film",fault:"",row:1,style:"photographic",direction:"live-action/photographic",preset:"auto"},
  {name:"drawn",fault:"drawn",row:3,style:"illustrated",direction:"drawn, illustrated or anime",preset:"auto"},
  {name:"photo",fault:"photo",row:1,style:"photographic",direction:"live-action/photographic",preset:"auto"},
  {name:"GIF photo-style fixture",fault:"gif-photo",row:2,style:"photographic",direction:"live-action/photographic",preset:"auto"},
  {name:"explicit comic override",fault:"",row:1,style:"photographic",direction:"single-panel reaction comic",preset:"light-comic"}
])for(const language of (scenario.name==="film"||scenario.name==="drawn"?["en","zh-CN"]:["en"])){
  test(`${scenario.name}: ${language} both real-route fixture prompts keep one medium with no automatic calls`,async({page})=>{
    fault=scenario.fault;const en=language==="en";
    await page.goto(origin+"/chat");
    const response=await api(page,"demo",{language,scenario:"combined"});expect(response.status).toBe(200);
    const messages=response.value.messages;await page.reload();
    await page.getByLabel("Language / 语言").selectOption(language);
    await openCreate(page,language);
    await page.getByLabel(en?"What would you like to express?":"你想表达什么？",{exact:true}).fill("Work work");
    await page.getByLabel(en?"Visual context (optional override)":"图片上下文（可选指定）",{exact:true}).selectOption(messages[scenario.row].id);
    await page.getByLabel(en?"Expression style":"表达风格",{exact:true}).selectOption(scenario.preset);
    await page.getByRole("checkbox",{name:en?"Include web image search":"包含全网图片搜索",exact:true}).uncheck();
    await expect(page.locator(".reply-style-policy")).toContainText(scenario.preset==="auto"
      ?en?"not the medium":"不默认更换媒介":en?"Explicit style selected":"已明确选择风格");
    expect(plans.length+ranks.length+queries.length+images.length).toBe(0);
    await page.getByRole("button",{name:en?"Create 2 options":"创建 2 个方案",exact:true}).click();
    await expect(page.locator(".generation-batch > [role=status]")).toHaveText(en?"2 of 2 ready":"2 个方案中已有 2 个就绪",{timeout:15000});
    expect(plans).toHaveLength(1);expect(images).toHaveLength(2);expect(queries.length+ranks.length).toBe(0);
    const plan=JSON.parse(plans[0]),payload=JSON.parse(plan.messages[1].content[0].text);
    expect(payload.context).toHaveLength(9);expect(payload.replyTo).toBe(`c${scenario.row+1}`);
    expect(payload.frames.every((frame:{context:string})=>frame.context===payload.replyTo)).toBe(true);
    expect(plan.messages[1].content.filter((part:{type:string})=>part.type==="image_url")).toHaveLength(scenario.row===2?2:1);
    const directions=images.map(body=>JSON.parse(JSON.parse(body).prompt.split("\n").at(-1)));
    for(const value of directions){
      expect(value.contextDirection.visualStyle).toBe(scenario.style);
      expect(value.styleDirection).toContain(scenario.direction);
      expect(value.treatment).toContain("SAME visual world and medium");
      if(scenario.row===1&&scenario.fault==="")expect(value.contextDirection.characters).toEqual(["Gandalf"]);
      else expect(value.contextDirection.characters).toEqual([]);
    }
    expect(directions[0].styleDirection).toBe(directions[1].styleDirection);
    expect(directions[0].treatment).not.toBe(directions[1].treatment);
    await expect(page.locator(".context-style-cue")).toContainText(scenario.preset==="light-comic"?"explicit choice"
      :scenario.style==="illustrated"?en?"Drawn / illustrated":"绘制／插画风":en?"Live-action / photographic":"真人实拍／照片风");
    const directory=resolve(".local","visual-context","style-continuity-offline");await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,`${scenario.name.replaceAll(" ","-")}-${language}.json`),JSON.stringify({
      fixtureProvider:true,paidCalls:0,selectedId:messages[scenario.row].id,planRequest:plan,generationDirections:directions,
      calls:{plans:plans.length,images:images.length,search:queries.length,ranks:ranks.length}},null,2));
    await page.locator(".generation-batch").screenshot({path:resolve(directory,`${scenario.name.replaceAll(" ","-")}-${language}.png`)});
  });
}
