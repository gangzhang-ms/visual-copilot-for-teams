import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {emptySpeakerProfile} from "../../src/shared/expression";

let app:Awaited<ReturnType<typeof Factory>>,origin:string,mode="ok",sent:Record<string,unknown>[],publicCalls:{url:string;init?:RequestInit}[];
let releaseCancel:(()=>void)|undefined;
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(name:string)=>pathToFileURL(resolve(root,"server",name)).href;
test.beforeEach(async()=>{
  mode="ok";sent=[];publicCalls=[];releaseCancel=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const image=await sharp({create:{width:64,height:64,channels:3,background:"#aabbee"}}).png().toBuffer();
  app=await createLocalChatServer("OFFLINE-MEME-TEST",{interaction:"direct-personal",cooldownMs:0,clientRoot:resolve(root,"client"),
    memeTransport:async(url,init)=>{
      publicCalls.push({url:String(url),init});
      if(mode==="held")return new Response(new ReadableStream({cancel:()=>new Promise<void>(resolve=>{
        const timer=setTimeout(resolve,5000);releaseCancel=()=>{clearTimeout(timer);resolve();};
      })}),{headers:{"Content-Type":"application/json"}});
      if(mode==="fail")return new Response("",{status:503});
      if(String(url)==="https://api.imgflip.com/get_memes")return Response.json({success:true,data:{memes:Array.from({length:6},(_,i)=>({
        id:String(100+i),name:`Fixture template ${i}`,url:`https://i.imgflip.com/a${i}.png`,width:mode==="dimension"?65:64,height:64,box_count:2
      }))}});
      if(mode==="redirect")return new Response("",{status:302,headers:{Location:"https://evil.test"}});
      return new Response(Uint8Array.from(image),{headers:{"Content-Type":"image/png"}});
    },
    transport:async(_url,init)=>{
      const payload=JSON.parse(JSON.parse(String(init?.body)).messages[1].content[0].text);sent.push(payload);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(payload.task==="explain"?{
        background:{source:null,context:null,frames:[]},observations:[{text:"Internet template explanation fixture",frames:payload.frames.map((f:{id:string})=>f.id)}],
        commonUsage:["Context dependent"],contextualInterpretations:[{text:"Possible fixture",context:payload.context.map((c:{label:string})=>c.label)}],
        uncertainties:["No actual intent"],safeResponseGuidance:["Ask kindly"]
      }:{candidates:payload.catalog.slice(0,3).map((a:{id:string})=>({
        id:a.id,reason:"OFFLINE context-specific template choice",caution:"Template needs a caption; familiarity is not universal"
      }))})}}]});
    }
  });origin=await app.start(0);
});
test.afterEach(async()=>{releaseCancel?.();await app.close();});
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const session=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:JSON.stringify(path==="session/close"?{}:{revision:session.revision,...body})});
    return {status:response.status,value:await response.json()};
  },{path,body});
}
async function open(page:Page){await page.goto(origin+"/chat");await page.getByLabel("Language / 语言").selectOption("en");await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeEnabled();}

test("default Express loads public templates, ranks exactly three actual IDs with reports, previews and inserts only locally",async({page,browser})=>{
  await open(page);expect(publicCalls).toHaveLength(0);
  await page.getByLabel("Message",{exact:true}).fill("Our fictional lunch group has two harmless options.");
  await page.getByLabel("Message",{exact:true}).press("Enter");await expect(page.getByTestId("chat-message")).toHaveCount(1);
  await api(page,"speaker/profile",{speaker:"Alex",profile:{...emptySpeakerProfile(),language:"en",familiarity:"casual internet templates",tone:"gentle uncertainty"}});
  await page.getByRole("button",{name:"Help me express",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Expression source",exact:true})).toHaveValue("internet");
  await page.getByLabel("What would you like to express?",{exact:true}).fill("friendly uncertainty between two lunch options");
  const reviewed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/review");
  await page.getByRole("button",{name:"Review selected content",exact:true}).click();
  expect((await reviewed).status()).toBe(200);
  await expect(page.getByRole("region",{name:"Content confirmation",exact:true})).toBeVisible();
  expect(publicCalls).toHaveLength(7);expect(app.counters.providerRequests).toBe(0);
  expect(publicCalls.every(c=>c.init?.body===undefined&&c.init?.method==="GET"&&c.init?.redirect==="error")).toBe(true);
  expect(JSON.stringify(publicCalls)).not.toContain("lunch");
  await page.getByRole("button",{name:"Recommend expressions",exact:true}).click();
  await expect(page.locator(".local-candidate")).toHaveCount(3);
  const payload=sent[0];expect(payload.speakerContext).toMatchObject({role:"outgoing-speaker",profile:{tone:"gentle uncertainty"}});
  expect(payload.intent).toContain("lunch");expect(payload.frames).toEqual([]);
  const pool=payload.catalog as {id:string}[];expect(pool.every(a=>a.id.startsWith("imgflip-"))).toBe(true);
  for(const img of await page.locator(".local-candidate img").all())await expect.poll(()=>img.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);
  await page.getByLabel("Optional local caption",{exact:true}).fill("Both sound good!");
  await page.getByRole("button",{name:"Preview insertion",exact:true}).first().click();
  await expect(page.getByRole("region",{name:"Local insertion preview",exact:true})).toContainText("Imgflip popular template");
  await page.getByRole("button",{name:"Insert into local chat",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(2);
  const own=await api(page,"state"),visual=own.value.messages[1].visual;
  expect(visual.template).toMatchObject({kind:"popular-template",provider:"Imgflip"});
  expect(own.value.messages[1].text).toBe("Both sound good!");
  const bubble=page.getByTestId("chat-message").last();
  expect(await bubble.innerText()).not.toMatch(/Imgflip popular template|redistribution rights/iu);
  await bubble.getByRole("button",{name:"Message actions",exact:true}).click();
  await page.getByRole("menuitem",{name:"Media information",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Media information",exact:true})).toContainText("Imgflip popular template");
  await page.keyboard.press("Escape");
  await expect(bubble.getByRole("button",{name:"Message actions",exact:true})).toBeFocused();
  await page.getByTestId("chat-message").last().getByRole("button",{name:"Explain",exact:true}).click();
  await page.locator(".explanation-details > summary").click();
  await expect(page.getByText("Internet template explanation fixture",{exact:false})).toBeVisible();
  await expect(page.getByRole("region",{name:"Transmission preview"})).toHaveCount(0);
  expect(sent[1].frames).toHaveLength(1);
  expect(await (await page.request.get(origin+visual.imageUrl)).body()).not.toHaveLength(0);
  const stranger=await browser.newContext();
  try{const p=await stranger.newPage();await open(p);expect((await p.request.get(origin+visual.imageUrl)).status()).toBe(400);}
  finally{await stranger.close();}
  await api(page,"catalog/source",{source:"original-demo"});
  expect((await page.request.get(origin+visual.imageUrl)).status()).toBe(200);
  expect((await api(page,"state")).value.messages[1].visual).toEqual(visual);
  expect(app.counters.providerRequests).toBe(2);expect(app.generationCounters.providerRequests).toBe(0);
  page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Close this room",exact:true}).click();
  expect(app.resources().memeBytes).toBe(0);
});

test("provider failure has no silent original-demo fallback and explicit source change remains available",async({page})=>{
  mode="fail";await open(page);await page.getByRole("button",{name:"Help me express",exact:true}).click();
  await page.getByLabel("What would you like to express?",{exact:true}).fill("A harmless fictional lunch choice");
  await page.getByRole("button",{name:"Review selected content",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Imgflip is unavailable");
  expect((await api(page,"state")).value).toMatchObject({catalogSource:"internet",catalogAccepted:false});
  await expect(page.locator(".local-candidate")).toHaveCount(0);expect(app.counters.providerRequests).toBe(0);
  await page.getByRole("combobox",{name:"Expression source",exact:true}).selectOption("original-demo");
  await expect(page.getByRole("combobox",{name:"Expression source",exact:true})).toHaveValue("original-demo");
  expect((await api(page,"state")).value.catalogAccepted).toBe(true);
});

for(const failure of ["dimension","redirect"])test(`rejects ${failure} before publishing any images or candidates`,async({page})=>{
  mode=failure;await open(page);const result=await api(page,"catalog/load");
  expect(result.status).toBe(400);expect((await api(page,"state")).value.internetCatalog).toBeUndefined();
  expect(app.resources().memeBytes).toBe(0);expect(app.counters.providerRequests).toBe(0);
});

test("shared public cache needs owner membership, retains bytes for remaining owners, refresh invalidates review",async({page,browser})=>{
  await open(page);const loaded=await api(page,"catalog/load"),first=loaded.value.internetCatalog.assets[0].visual;
  const retained=app.resources().memeBytes;
  const other=await browser.newContext();
  try{
    const p=await other.newPage();await open(p);
    expect((await p.request.get(origin+first.imageUrl)).status()).toBe(400);
    await api(p,"catalog/load");expect(app.resources().memeBytes).toBe(retained);
    expect(app.memeCounters.imageRequests).toBe(6);expect(app.memeCounters.metadataRequests).toBe(2);
    const input={version:0,intent:"friendly choice",context:[],preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}};
    const review=await api(page,"review",{command:"recommendVisual",input});
    await api(page,"catalog/load");
    expect((await api(page,"process",{digest:review.value.processing.digest,consent:true})).status).toBe(400);
    await api(page,"session/close");
    expect(app.resources().memeBytes).toBe(retained);expect((await p.request.get(origin+first.imageUrl)).status()).toBe(200);
    await api(p,"session/close");expect(app.resources().memeBytes).toBe(0);
  }finally{await other.close();}
  expect(app.counters.providerRequests).toBe(0);
});

test("owner close cancels public loading and retains its pending cleanup until the response settles",async({page,browser})=>{
  mode="held";await open(page);
  const pending=api(page,"catalog/load");
  await expect.poll(()=>app.memeCounters.metadataRequests).toBe(1);
  await api(page,"session/close");
  await expect.poll(()=>typeof releaseCancel).toBe("function");
  expect(app.resources().retiringSessions).toBe(1);
  const c=await browser.newContext();
  try{
    const p=await c.newPage();await open(p);
    expect((await api(p,"catalog/load")).value.code).toBe("busy");
    releaseCancel!();releaseCancel=undefined;await pending;
    await expect.poll(()=>app.resources().retiringSessions).toBe(0);
    expect(app.resources().memeBytes).toBe(0);
    await api(p,"session/close");
  }finally{await c.close();}
  expect(app.counters.providerRequests).toBe(0);
});
