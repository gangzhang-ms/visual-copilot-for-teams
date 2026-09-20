import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {ownedBrowserSession} from "./local-browser-session.mjs";

const rank=process.argv.length===3&&process.argv[2]==="--run-authorized-ranking";
if(process.argv.length!==2&&!rank)throw new Error("Only optional --run-authorized-ranking is supported (one original synthetic Azure ranking call).");
const origin="http://127.0.0.1:4325",directory=resolve(".local","visual-context","memes-validation");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin);
const report={origin,recordedAt:"",mocked:false,templateCount:0,images:[],modelRoutes:0,imageGenerationRoutes:0,rankStatus:0,ranked:[],
  inserted:false,ownRoomClosed:false,passed:false,rankingApiVersion:"2024-10-21"};
page.on("request",r=>{
  const path=new URL(r.url()).pathname;
  if(path==="/local/process")report.modelRoutes++;
  if(path==="/local/generation/process")report.imageGenerationRoutes++;
});
try{
  await owned.start();await page.goto(origin+"/chat");await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeEnabled();
  await page.getByLabel("Message",{exact:true}).fill("Fictional lunch club: shall we choose soup or sandwiches? Both are fine.");
  await page.getByLabel("Message",{exact:true}).press("Enter");await expect(page.getByTestId("chat-message")).toHaveCount(1);
  await page.getByRole("button",{name:"Help me express",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Expression source",exact:true})).toHaveValue("internet");
  await page.locator(".speaker-profile summary").click();
  await page.getByLabel("Online-community familiarity",{exact:true}).fill("Voluntary fictional preference: familiar with English-language captioned meme templates.");
  await page.getByLabel("Speaker tone",{exact:true}).fill("Friendly uncertainty, gentle and not mocking anyone.");
  await page.getByRole("button",{name:"Save speaker profile",exact:true}).click();
  await expect(page.locator(".speaker-profile summary")).toContainText("self-reported");
  await page.locator(".speaker-profile summary").click();
  const loaded=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/catalog/load",{timeout:100_000});
  await page.getByRole("button",{name:"Load / refresh public templates",exact:true}).click();
  const response=await loaded;
  expect(response.status()).toBe(200);
  const state=await response.json();
  expect(state.catalogSource).toBe("internet");report.templateCount=state.internetCatalog.assets.length;
  expect(report.templateCount).toBeGreaterThanOrEqual(6);
  for(const {visual} of state.internetCatalog.assets){
    expect(visual.template.provider).toBe("Imgflip");
    const response=await page.request.get(origin+visual.imageUrl);expect(response.status()).toBe(200);
    const buffer=await response.body(),meta=await sharp(buffer).metadata();
    expect(meta.format).toBe("png");expect(meta.width).toBeLessThanOrEqual(512);expect(meta.height).toBeLessThanOrEqual(512);
    report.images.push({id:visual.id,name:visual.alt,fetchedAt:visual.template.fetchedAt,width:meta.width,height:meta.height,bytes:buffer.length,sha256:createHash("sha256").update(buffer).digest("hex")});
    if(report.images.length<=3)await writeFile(resolve(directory,visual.id+".png"),buffer);
  }
  await page.getByLabel("Intent or question",{exact:true}).fill("Friendly uncertainty between two harmless lunch options, soup or sandwiches. Gentle humor; no ridicule or political endorsement.");
  await page.getByRole("button",{name:"Preview model request",exact:true}).click();
  await expect(page.getByRole("region",{name:"Transmission preview",exact:true})).toBeVisible();
  await page.screenshot({path:resolve(directory,"review-desktop.png")});
  if(rank){
    await writeFile(resolve(directory,"ranking-attempt.json"),JSON.stringify({authorizedSynthetic:true,maximumCalls:1,createdAt:new Date().toISOString()})+"\n",{flag:"wx"});
    const ranked=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/process",{timeout:60_000});
    await page.getByRole("button",{name:"Recommend expressions",exact:true}).click();
    const response=await ranked;report.rankStatus=response.status();expect(report.rankStatus).toBe(200);
    const {result}=await response.json();
    expect(result.kind).toBe("recommendations");expect(result.candidates).toHaveLength(3);
    expect(new Set(result.candidates.map(c=>c.visual.id)).size).toBe(3);
    expect(result.candidates.every(c=>state.internetCatalog.assets.some(a=>a.visual.id===c.visual.id))).toBe(true);
    report.ranked=result.candidates.map(c=>({id:c.visual.id,name:c.visual.alt,reason:c.reason,caution:c.caution}));
    await expect(page.locator(".local-candidate")).toHaveCount(3);
    await page.screenshot({path:resolve(directory,"ranked-desktop.png")});
    await page.getByLabel("Optional local caption",{exact:true}).fill("Soup or sandwiches? Happily undecided.");
    await page.getByRole("button",{name:"Preview insertion",exact:true}).first().click();
    await expect(page.getByRole("region",{name:"Local insertion preview",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Insert into local chat",exact:true}).click();
    await expect(page.getByTestId("chat-message")).toHaveCount(2);
    await expect(page.getByTestId("chat-message").last()).toContainText("Soup or sandwiches? Happily undecided.");
    await expect(page.getByTestId("chat-message").last()).toContainText("Imgflip popular template");
    report.inserted=true;await page.screenshot({path:resolve(directory,"inserted-desktop.png")});
  }
  await page.getByLabel("Language / 语言").selectOption("zh-CN");await page.setViewportSize({width:320,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:resolve(directory,"mobile.png")});
  expect(report.modelRoutes).toBe(rank?1:0);expect(report.imageGenerationRoutes).toBe(0);report.passed=true;
}finally{
  try{report.ownRoomClosed=(await owned.close()).closed;expect(report.ownRoomClosed).toBe(true);}
  catch(error){report.passed=false;throw error;}
  finally{
    await context.close();await browser.close();report.recordedAt=new Date().toISOString();
    await writeFile(resolve(directory,rank?"live-ranking-report.json":"public-source-report.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify(report,null,2));
  }
}
