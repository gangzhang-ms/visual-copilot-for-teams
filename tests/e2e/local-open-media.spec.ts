import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {offlineDraft} from "../../src/server/generation.test.support";
import {emptySpeakerProfile} from "../../src/shared/expression";
const root=process.env.VISUAL_BUILD_ROOT??"dist";
const built=(name:string)=>pathToFileURL(resolve(root,"server",name)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,requests:number[],png:Buffer;
const realNow=Date.now;let advance=0;
test.beforeEach(async()=>{
  advance=0;Date.now=()=>realNow()+advance;
  let seed=12345;const raw=Buffer.alloc(512*512*4);
  for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=i%4===3?255:seed>>>24;}
  png=await sharp(raw,{raw:{width:512,height:512,channels:4}}).png().toBuffer();
  expect(png.length).toBeLessThanOrEqual(1024*1024);requests=[];
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const generated=await sharp(Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" fill="white"/><circle cx="400" cy="400" r="200" fill="#ae4422"/></svg>')).png().toBuffer();
  const meme=await sharp({create:{width:64,height:64,channels:3,background:"#abcdff"}}).png().toBuffer();
  app=await createLocalChatServer("OFFLINE-OPEN-MEDIA",{
    interaction:"direct-personal",cooldownMs:0,clientRoot:resolve(root,"client"),
    generation:{...ongoingPersonalGenerationOptions(),transport:async()=>Response.json({data:[{b64_json:generated.toString("base64")} ]})},
    memeTransport:async url=>String(url)==="https://api.imgflip.com/get_memes"
      ?Response.json({success:true,data:{memes:Array.from({length:6},(_,i)=>({id:String(100+i),name:`Fixture ${i}`,url:`https://i.imgflip.com/a${i}.png`,width:64,height:64,box_count:2}))}})
      :new Response(Uint8Array.from(meme),{headers:{"Content-Type":"image/png"}}),
    transport:async(_url,init)=>{
      requests.push(Buffer.byteLength(String(init?.body)));const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content[0].text);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        background:{source:null,context:null,frames:[]},observations:[{text:"Bounded synthetic pixels",frames:input.frames.map((f:{id:string})=>f.id)}],commonUsage:["No inferred intent"],
        contextualInterpretations:[{text:"Fictional context",context:input.context.map((c:{label:string})=>c.label)}],
        uncertainties:["Fixture only"],safeResponseGuidance:["Ask kindly"]
      })}}]});
    }
  });origin=await app.start(0);
});
test.afterEach(async()=>{await app.close();Date.now=realNow;});
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const s=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const r=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":s.csrf},
      body:JSON.stringify(path==="session/close"?{}:path==="generation/process"?body:{revision:s.revision,...body})});
    return {status:r.status,value:await r.json()};
  },{path,body});
}
async function open(page:Page){
  await page.goto(origin+"/chat");await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
}
function input(id:string){return {version:0,intent:"",context:[{label:id,text:"Original fixture",included:true,timestamp:""}],
  preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}};}
async function explain(page:Page,id:string){
  const review=await api(page,"review",{command:"explainVisual",selectedId:id,input:input(id)});
  expect(review.status,JSON.stringify(review.value)).toBe(200);
  const result=await api(page,"process",{digest:review.value.processing.digest,consent:true});
  expect(result.status,JSON.stringify(result.value)).toBe(200);return review.value;
}
test("room retains over 8 MiB with original owners; large Explain, generation, animation, derivative and meme access still work",async({page})=>{
  test.setTimeout(120_000);await open(page);
  const ids:string[]=[];
  for(let i=0;i<7;i++){
    const added=await api(page,"message",{speaker:"Maya",text:`Original fixture ${i}`,attachment:{mime:"image/png",base64:png.toString("base64"),category:"image"}});
    expect(added.status,JSON.stringify(added.value.code)).toBe(200);ids.push(added.value.messages[i].id);
  }
  let room=(await api(page,"state")).value;
  expect(room.mediaBytes).toBeGreaterThan(8*1024*1024);expect(room.messages.map((m:{id:string})=>m.id)).toEqual(ids);
  expect(app.resources().ordinaryMediaBytes).toBe(room.mediaBytes);expect(requests).toHaveLength(0);
  const reviewed=await explain(page,ids[0]);
  expect(reviewed.processing.serializedBytes).toBeGreaterThan(256*1024);
  expect(requests[0]).toBe(reviewed.processing.serializedBytes);
  expect(reviewed.input.context).toHaveLength(1);
  const r=await api(page,"generation/review",{draftRevision:0,draft:offlineDraft()});
  expect(r.status).toBe(200);
  const generated=await api(page,"generation/process",{operationId:r.value.operationId,digest:r.value.digest,consent:true});
  expect(generated.value.status,JSON.stringify(generated.value)).toBe("ready");
  const assetId=generated.value.image.assetId;
  advance+=61_001;
  expect((await page.request.get(origin+generated.value.image.posterUrl)).status()).toBe(200);
  const animated=await api(page,"generation/animate",{assetId});
  expect(animated.status,JSON.stringify(animated.value)).toBe(200);
  const preview=await api(page,"generation/preview",{assetId,variant:"animation",caption:"A fictional reaction",alt:"Original synthetic shape",speaker:"Maya"});
  expect(preview.status,JSON.stringify(preview.value)).toBe(200);
  const inserted=await api(page,"generation/insert",{handle:preview.value.handle});
  expect(inserted.status).toBe(200);
  await explain(page,inserted.value.messages.at(-1).id);
  const loaded=await api(page,"catalog/load");
  expect(loaded.status,JSON.stringify(loaded.value.code)).toBe(200);expect(app.resources().memeBytes).toBeGreaterThan(0);
  const meme=loaded.value.internetCatalog.assets[0].visual;
  const ownedMeme=await page.request.get(origin+meme.imageUrl);
  expect(ownedMeme.status()).toBe(200);expect((await ownedMeme.body()).length).toBeGreaterThan(0);
  room=(await api(page,"state")).value;
  expect(room.messages.slice(0,7).map((m:{id:string})=>m.id)).toEqual(ids);
  expect(room.mediaBytes).toBeGreaterThan(8*1024*1024);
  await page.reload();await expect(page.getByTestId("chat-message")).toHaveCount(8);
  await expect.poll(()=>page.getByTestId("chat-message").first().locator("img.local-upload").evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  expect(app.counters.providerRequests).toBe(2);expect(app.generationCounters.providerRequests).toBe(1);
  console.log(JSON.stringify({roomMediaBytes:room.mediaBytes,largeModelRequestBytes:requests[0],retainedOriginalMessages:ids.length,mockModelCalls:2,mockImageCalls:1}));
  const closed=await api(page,"session/close");expect(closed.value.closed).toBe(true);
  expect(app.resources()).toMatchObject({ordinaryMediaBytes:0,generatedBytes:0,memeBytes:0});
});
test("retained message and speaker counts report count-specific errors, not removed byte quotas",async({page})=>{
  await open(page);
  for(let i=0;i<40;i++)expect((await api(page,"message",{speaker:"Maya",text:`Fictional text ${i}`})).status).toBe(200);
  expect((await api(page,"message",{speaker:"Maya",text:"One more"})).value.code).toBe("local-message-capacity");
  for(let i=0;i<16;i++)expect((await api(page,"speaker/profile",{speaker:`Speaker ${i}`,profile:emptySpeakerProfile()})).status).toBe(200);
  expect((await api(page,"speaker/profile",{speaker:"One more",profile:emptySpeakerProfile()})).value.code).toBe("local-profile-capacity");
  expect((await api(page,"speaker/profile",{speaker:"Speaker 0",profile:emptySpeakerProfile()})).status).toBe(200);
  expect(requests).toHaveLength(0);
});
test("safe GIF larger than the old serialized request cap goes through one-click review and the actual worker/gateway",async({page})=>{
  await open(page);
  const frame=await sharp(png).resize(256,256).removeAlpha().raw().toBuffer();
  const gif=await sharp(Buffer.concat([frame,Buffer.from(frame).reverse()]),{raw:{width:256,height:512,channels:3,pageHeight:256}})
    .gif({delay:[200,300],loop:0}).toBuffer();
  expect(gif.length).toBeLessThan(1024*1024);
  await page.getByLabel("Attach visual").setInputFiles({name:"original.gif",mimeType:"image/gif",buffer:gif});
  await page.getByRole("button",{name:"Add locally",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(1);expect(requests).toHaveLength(0);
  await page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true}).click();
  await page.locator(".explanation-details > summary").click();
  await expect(page.getByText("Bounded synthetic pixels",{exact:true})).toBeVisible();
  expect(requests).toHaveLength(1);expect(requests[0]).toBeGreaterThan(256*1024);
  console.log(JSON.stringify({gifModelRequestBytes:requests[0]}));
});
test("envelope diagnostics retain API numbers but display an actionable human message",async({page})=>{
  await open(page);await api(page,"message",{speaker:"Maya",text:"😂"});await page.reload();
  await page.getByLabel("Language / 语言").selectOption("en");
  await page.route("**/local/review",route=>route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({
    status:"blocked",code:"model-request-envelope-exceeded",byteLimit:{actualBytes:12582913,allowedBytes:12582912}
  })}));
  await page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("too much content for one request");
  await expect(page.getByRole("alert")).not.toContainText(/12582913|12582912|bytes/);
  await expect(page.getByRole("alert")).not.toContainText("Remove large messages");
  expect(requests).toHaveLength(0);
});
