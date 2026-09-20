import {chromium,expect} from "@playwright/test";
import {mkdir,open,writeFile,stat} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {ownedBrowserSession} from "./local-browser-session.mjs";

const live=process.argv[2]==="--run-authorized-synthetic";
if(process.argv.length!==(live?3:2))throw new Error("Use no arguments for no-call UI checks, or --run-authorized-synthetic for at most two original image calls.");
const origin="http://127.0.0.1:4322",directory=resolve(".local","visual-context","expressive-validation");
await mkdir(directory,{recursive:true});
if(live)for(const id of ["restrained-thanks","deadpan-relief"]){
  const exists=await stat(resolve(directory,id+"-attempt.json")).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;});
  if(exists)throw new Error("These synthetic image attempts were already recorded. Do not repeat or overwrite their evidence.");
}
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin);
const report={recordedAt:"",origin,mocked:false,paidRoutes:0,decoderRoutes:0,passed:false,cases:[],screenshots:[]};
page.on("request",r=>{const path=new URL(r.url()).pathname;if(path==="/local/generation/process")report.paidRoutes++;if(path==="/local/process")report.decoderRoutes++;});
async function sessionRequest(path,body={}){
  return page.evaluate(async({path,body})=>{
    const r=await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    if(!r.ok)throw new Error("Own synthetic session unavailable");
    const s=await r.json(),response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":s.csrf},body:JSON.stringify(body)});
    if(!response.ok)throw new Error("Synthetic local operation failed");return response.json();
  },{path,body});
}
async function screenshot(name,width,height=900){
  await page.setViewportSize({width,height});await page.mouse.move(1,1);
  if(name.includes("create"))await page.locator(".local-copilot-content").evaluate(e=>{e.scrollTop=0;});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
  expect(await page.locator("body").innerText()).not.toMatch(/billed|billing|paid request|计费|付费/iu);
  await page.screenshot({path:resolve(directory,name+".png")});report.screenshots.push(name+".png");
}
async function fillProfile(profile){
  const summary=page.locator(".speaker-profile summary");
  if(!await page.locator(".speaker-profile").evaluate(e=>e.open))await summary.click();
  await page.getByLabel("Profile language",{exact:true}).selectOption(profile.language);
  for(const [label,key] of [["Voluntary cultural context","culture"],["Online-community familiarity","familiarity"],["Speaker tone","tone"],["Speaker humor","humor"],["Sensitive topics / avoid","avoid"]])
    await page.getByLabel(label,{exact:true}).fill(profile[key]);
  await page.getByRole("button",{name:"Save speaker profile",exact:true}).click();
  await expect(summary).toContainText("self-reported");
  await summary.click();
}
try{
  await owned.start();
  expect((await page.request.get(origin+"/healthz")).ok()).toBe(true);
  await page.goto(origin+"/chat");await page.getByLabel("Language / 语言").selectOption("en");
  await page.getByRole("button",{name:"Start a demo conversation",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(5);
  await page.getByRole("button",{name:"Create image / GIF",exact:true}).click();
  await fillProfile({language:"en",culture:"",familiarity:"Fictional online puzzle team",tone:"Warm",humor:"Gentle",avoid:"No stereotypes"});
  await page.getByLabel("Creative intent",{exact:true}).fill("Warm thanks to a fictional teammate.");
  await page.getByRole("button",{name:"Prepare exact creative brief",exact:true}).click();
  await expect(page.getByRole("button",{name:"Generate image",exact:true})).toBeEnabled();
  await screenshot("desktop-create-en",1440);
  await page.getByRole("button",{name:"Express",exact:true}).click();
  await page.getByLabel("Intent or question",{exact:true}).fill("Thank a fictional teammate.");
  await page.getByRole("button",{name:"Preview model request",exact:true}).click();
  await expect(page.getByRole("button",{name:"Recommend expressions",exact:true})).toBeEnabled();
  await expect(page.getByRole("region",{name:"Transmission preview"}).getByRole("checkbox")).toHaveCount(0);
  await page.getByTestId("chat-message").first().getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".speaker-profile summary")).toContainText("Maya");
  await page.getByRole("button",{name:"Preview model request",exact:true}).click();
  await expect(page.getByRole("button",{name:"Explain with AI",exact:true})).toBeEnabled();
  await screenshot("desktop-explain-en",1920,1080);
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await page.getByRole("button",{name:"创作",exact:true}).click();
  await screenshot("mobile-create-zh",320);
  await page.getByRole("button",{name:"收起 AI 面板",exact:true}).click();
  await screenshot("mobile-chat-zh",320);
  expect(report.paidRoutes).toBe(0);expect(report.decoderRoutes).toBe(0);
  if(live){
    const cases=[
      {id:"restrained-thanks",speaker:"Rui (simulated)",style:"reaction-sticker",intensity:"restrained",
        profile:{language:"zh-CN",culture:"",familiarity:"Voluntary preference: Chinese-language work chat, brief understated thanks; no nationality or ethnicity asserted.",tone:"Sincere and restrained, appropriate for a work group",humor:"No teasing",avoid:"No flags, cultural costumes, or exaggerated flattery"},
        intent:"Thank a fictional teammate for patiently helping a beginner.",
        creative:"One original friendly cartoon gardener, chest-up, one hand gently over the heart, the other holding a single small potted sprout. Small warm smile, soft attentive eyes, plain apron, coherent hands. Simple cream background. No text."},
      {id:"deadpan-relief",speaker:"Morgan (simulated)",style:"deadpan-animal",intensity:"balanced",
        profile:{language:"en",culture:"",familiarity:"Voluntary preference: English-language internet reaction stickers and gentle self-deprecating humor.",tone:"Playful deadpan, friendly enough for colleagues",humor:"Understated relief, not sarcasm directed at others",avoid:"No insults, brand characters or written captions"},
        intent:"Celebrate finally fixing a tiny fictional bug with quietly comic relief.",
        creative:"One original sleepy little owl holding a tiny plain mug in one wing. Half-lidded eyes, a relieved little smile, relaxed posture on a simple short perch. Large clear face, coherent wings, sparse pale background. No text."}
    ];
    let lastDispatch=0;
    for(const item of cases){
      await sessionRequest("reset");await page.setViewportSize({width:1440,height:900});await page.reload();
      await page.getByLabel("Language / 语言").selectOption("en");
      await page.getByLabel("Simulated speaker",{exact:true}).fill(item.speaker);
      await page.getByRole("button",{name:"Create image / GIF",exact:true}).click();
      await fillProfile(item.profile);
      await page.getByLabel("Creative intent",{exact:true}).fill(item.intent);
      await page.getByLabel("Creative description",{exact:true}).fill(item.creative);
      await page.getByLabel("Expression style",{exact:true}).selectOption(item.style);
      await page.getByLabel("Expression intensity",{exact:true}).selectOption(item.intensity);
      if(lastDispatch)await new Promise(r=>setTimeout(r,Math.max(0,62_000-(Date.now()-lastDispatch))));
      const reviewed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/review");
      await page.getByRole("button",{name:"Prepare exact creative brief",exact:true}).click();
      const review=await (await reviewed).json();
      await expect(page.getByRole("button",{name:"Generate image",exact:true})).toBeEnabled();
      const marker=await open(resolve(directory,item.id+"-attempt.json"),"wx");
      await marker.writeFile(JSON.stringify({id:item.id,startedAt:new Date().toISOString(),bodySha256:createHash("sha256").update(review.body).digest("hex"),maximumCalls:1})+"\n");await marker.sync();await marker.close();
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/process",{timeout:150_000});
      lastDispatch=Date.now();
      await page.getByRole("button",{name:"Generate image",exact:true}).click();
      const resultResponse=await response,result=await resultResponse.json(),elapsedMs=Date.now()-lastDispatch;
      const evidence={id:item.id,localHttpStatus:resultResponse.status(),status:result.status,code:result.code,elapsedMs,apiVersion:review.destination?.apiVersion};
      report.cases.push(evidence);
      if(result.status!=="ready"||!result.image)throw new Error(`Synthetic image failed: ${result.code??result.status}; no next image call.`);
      const responseImage=await page.request.get(origin+result.image.mediaUrl);
      expect(responseImage.ok()).toBe(true);
      const bytes=await responseImage.body(),metadata=await sharp(bytes).metadata();
      expect(metadata.format).toBe("png");expect(metadata.width).toBe(512);expect(metadata.height).toBe(512);
      await writeFile(resolve(directory,item.id+".png"),bytes);
      await sharp(bytes).resize(128,128).png().toFile(resolve(directory,item.id+"-128.png"));
      Object.assign(evidence,{bytes:bytes.length,width:metadata.width,height:metadata.height,sha256:createHash("sha256").update(bytes).digest("hex"),style:item.style,profile:item.profile,scene:item.creative});
      await page.getByLabel("Local output caption",{exact:true}).fill(item.id==="restrained-thanks"?"谢谢耐心帮忙。":"Small fix. Big relief.");
      await page.getByLabel("Image description / alt text",{exact:true}).fill("Original synthetic "+item.id+" reaction; manually inspect.");
      await page.getByRole("button",{name:"Preview generated insertion",exact:true}).click();
      await page.getByRole("button",{name:"Insert generated visual locally",exact:true}).click();
      await expect(page.getByTestId("chat-message")).toHaveCount(1);
      await page.getByRole("button",{name:"Hide AI panel",exact:true}).click();
      await screenshot(item.id+"-bubble",1440);
    }
    expect(report.paidRoutes).toBe(2);
  }
  expect(report.decoderRoutes).toBe(0);report.passed=true;
}finally{
  try{const state=await owned.close();if(report.passed)expect(state.closed).toBe(true);report.ownRoomClosed=state.closed;}
  catch(error){report.passed=false;report.cleanupFailed=true;throw error;}
  finally{
    report.recordedAt=new Date().toISOString();
    await writeFile(resolve(directory,live?"live-image-report.json":"ui-report.json"),JSON.stringify(report,null,2)+"\n");
    await context.close();await browser.close();console.log(JSON.stringify(report,null,2));
  }
}
