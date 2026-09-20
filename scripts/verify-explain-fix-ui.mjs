import {chromium,expect} from "@playwright/test";
import {mkdir,open,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const origin="http://127.0.0.1:4331",directory=resolve(".local","visual-context","explain-fix-validation");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext(),page=await context.newPage(),owned=ownedBrowserSession(page,origin);
const report={recordedAt:"",origin,modelRoutes:0,imageRoutes:0,sourceLoads:0,ownRoomClosed:false,passed:false};
page.on("request",r=>{const path=new URL(r.url()).pathname;if(path==="/local/generation/process")report.imageRoutes++;if(path==="/local/catalog/load")report.sourceLoads++;});
try{
  await owned.start();
  report.health=await (await page.request.get(origin+"/healthz")).json();
  expect(report.health).toMatchObject({ready:true,model:true,imageGeneration:"ready",sessionAdmission:"no-count-quota"});
  await page.goto(origin+"/chat");await expect(page.getByLabel("消息内容",{exact:true})).toBeEnabled();
  const demoResponse=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/demo");
  await page.getByRole("button",{name:"从演示对话开始",exact:true}).click();
  const demo=await (await demoResponse).json();await expect(page.getByTestId("chat-message")).toHaveCount(5);
  expect(demo.messages[2]).toMatchObject({speaker:"Leo",demoMedia:"local-motion",text:"我这边也好了，终于能下班了。"});
  const reviewPromise=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/review").then(async r=>{expect(r.status()).toBe(200);return r.json();});
  let guardFailure=false;
  await page.route("**/local/process",async route=>{
    try{
      const review=await reviewPromise,body=route.request().postDataJSON();
      expect(report.modelRoutes).toBe(0);
      expect(body).toMatchObject({consent:true,digest:review.processing.digest});
      expect(review.profileSpeaker).toBe("Leo");
      expect(review.input.speakerContext).toMatchObject({role:"selected-sender",profile:null});
      expect(review.input.context.map(c=>c.text)).toEqual(demo.messages.map(m=>`${m.speaker}: ${m.text}`));
      expect(review.media.samples).toHaveLength(2);
      const marker=await open(resolve(directory,"confirmation-attempt.json"),"wx");
      await marker.writeFile(JSON.stringify({startedAt:new Date().toISOString(),maximumCalls:1}));await marker.close();
      report.modelRoutes++;await route.continue();
    }catch{guardFailure=true;await route.abort();}
  });
  const processResponse=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/process",{timeout:60000});
  await page.getByTestId("chat-message").nth(2).getByRole("button",{name:"解释一下",exact:true}).click();
  const response=await processResponse;report.appHttpStatus=response.status();
  const value=await response.json();report.appCode=value.code??value.result?.status;
  expect(guardFailure).toBe(false);expect(response.status()).toBe(200);
  expect(value.result).toMatchObject({status:"ready",kind:"explanation"});
  const review=await reviewPromise,explanation=value.result.explanation,frames=review.media.samples.map(f=>f.id),labels=review.input.context.filter(c=>c.included).map(c=>c.label);
  report.inputTokens=review.processing.inputTokens;report.requestBytes=review.processing.serializedBytes;report.outputReserve=review.processing.outputReserve;
  report.observations=explanation.observations.length;report.interpretations=explanation.contextualInterpretations.length;
  expect(explanation.observations.every(o=>o.frames.every(f=>frames.includes(f)))).toBe(true);
  expect(explanation.contextualInterpretations.every(o=>o.context.every(c=>labels.includes(c)))).toBe(true);
  await expect(page.getByRole("heading",{name:"私密解释 — 并非发送者真实意图",exact:true})).toBeVisible();
  for(const name of ["可见内容 / 不确定的文字识别","常见用法","可能的上下文解读","不确定性与缺失信息","稳妥的澄清方式"])
    await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Transmission preview"})).toHaveCount(0);
  expect(report.modelRoutes).toBe(1);expect(report.imageRoutes+report.sourceLoads).toBe(0);
  report.explanationPanelVisible=true;report.referencesValid=true;report.passed=true;
}finally{
  try{report.ownRoomClosed=(await owned.close()).closed;expect(report.ownRoomClosed).toBe(true);}
  catch(error){report.passed=false;throw error;}
  finally{await context.close();await browser.close();report.recordedAt=new Date().toISOString();
    await writeFile(resolve(directory,"confirmation-report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));}
}
