import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import sharp from "sharp";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const origin="http://127.0.0.1:4326",directory=resolve(".local","visual-context","quick-explain-validation");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin);
const report={origin,recordedAt:"",mocked:false,modelRoutes:0,imageRoutes:0,sourceLoads:0,uploadStatus:0,explainEnabled:false,ownRoomClosed:false,passed:false};
page.on("request",r=>{const path=new URL(r.url()).pathname;if(path==="/local/process")report.modelRoutes++;
  if(path==="/local/generation/process")report.imageRoutes++;if(path==="/local/catalog/load")report.sourceLoads++;});
try{
  await owned.start();await page.goto(origin+"/chat");
  await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByText("Owned test content · Explain click runs AI · Nothing is sent to Teams",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Choose image or GIF",exact:true})).toBeEnabled();
  const buffer=await sharp({create:{width:64,height:64,channels:3,background:"#426ca5"}}).png().toBuffer();
  await page.getByLabel("Message",{exact:true}).fill("Self-authored non-sensitive blue square. No inference requested by this check.");
  await page.getByLabel("Attach visual").setInputFiles({name:"synthetic-square.png",mimeType:"image/png",buffer});
  await expect(page.getByAltText("Attachment preview",{exact:true})).toBeVisible();
  const added=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/message");
  await page.getByRole("button",{name:"Add locally",exact:true}).click();report.uploadStatus=(await added).status();
  expect(report.uploadStatus).toBe(200);await expect(page.getByTestId("chat-message")).toHaveCount(1);
  await expect(page.getByTestId("chat-message").getByRole("button",{name:"Explain",exact:true})).toBeEnabled();report.explainEnabled=true;
  await page.screenshot({path:resolve(directory,"desktop-no-inference.png")});
  await page.getByLabel("Language / 语言").selectOption("zh-CN");await page.setViewportSize({width:320,height:900});
  if(await page.getByRole("button",{name:"收起 AI 面板",exact:true}).isVisible())await page.getByRole("button",{name:"收起 AI 面板",exact:true}).click();
  await expect(page.getByTestId("chat-message").getByRole("button",{name:"解释一下",exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:resolve(directory,"mobile-no-inference.png")});
  expect(report.modelRoutes+report.imageRoutes+report.sourceLoads).toBe(0);report.passed=true;
}finally{
  try{report.ownRoomClosed=(await owned.close()).closed;expect(report.ownRoomClosed).toBe(true);}
  catch(error){report.passed=false;throw error;}
  finally{await context.close();await browser.close();report.recordedAt=new Date().toISOString();
    await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));}
}
