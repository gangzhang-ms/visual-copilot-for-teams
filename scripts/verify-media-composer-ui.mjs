import {chromium,expect} from "@playwright/test";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const origin="http://127.0.0.1:4329",directory=resolve(".local","visual-context","media-composer-validation");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin);
const report={origin,recordedAt:"",mocked:false,clipboardMethod:"File-bearing ClipboardEvent; no OS clipboard reads/writes",
  modelRoutes:0,imageRoutes:0,sourceLoads:0,pasteStatus:0,dropStatus:0,demoStatus:0,demoMessages:0,demoImages:0,demoGifs:0,ownRoomClosed:false,passed:false};
page.on("request",r=>{const path=new URL(r.url()).pathname;if(path==="/local/process")report.modelRoutes++;
  if(path==="/local/generation/process")report.imageRoutes++;if(path==="/local/catalog/load")report.sourceLoads++;});
async function transfer(kind,name,type){
  const bytes=await readFile(resolve("assets","chat-demo",name));
  await page.evaluate(({kind,name,type,base64})=>{
    const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],name,{type}));
    document.querySelector("textarea").dispatchEvent(kind==="paste"?new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:data}):new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:data}));
  },{kind,name,type,base64:bytes.toString("base64")});
  await expect(page.getByAltText("Attachment preview")).toBeVisible();
}
async function send(){
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/message");
  await page.getByRole("button",{name:"Add locally",exact:true}).click();const status=(await pending).status();expect(status).toBe(200);return status;
}
try{
  await owned.start();await page.goto(origin+"/chat");await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  await transfer("paste","gardener.png","image/png");
  await page.screenshot({path:resolve(directory,"composer-desktop.png")});
  await page.setViewportSize({width:320,height:900});
  if(await page.getByRole("button",{name:"Hide AI panel",exact:true}).isVisible())await page.getByRole("button",{name:"Hide AI panel",exact:true}).click();
  const preview=await page.getByAltText("Attachment preview").boundingBox();
  expect(preview.y+preview.height).toBeLessThan(900);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:resolve(directory,"composer-mobile.png")});
  report.pasteStatus=await send();
  await transfer("drop","owl-motion.gif","image/gif");
  await page.getByLabel("Message",{exact:true}).fill("Original prepared owl, local motion only.");
  report.dropStatus=await send();
  await expect(page.getByTestId("chat-message")).toHaveCount(2);
  await page.getByRole("button",{name:"Clear room",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(0);
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  const loaded=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/demo");
  await page.getByRole("button",{name:"从演示对话开始",exact:true}).click();
  const response=await loaded;report.demoStatus=response.status();expect(report.demoStatus).toBe(200);
  const room=await response.json();report.demoMessages=room.messages.length;
  report.demoImages=room.messages.filter(m=>m.attachment?.category==="image").length;report.demoGifs=room.messages.filter(m=>m.attachment?.category==="gif").length;
  expect([report.demoMessages,report.demoImages,report.demoGifs]).toEqual([5,1,1]);
  for(const index of [1,2])await expect(page.getByTestId("chat-message").nth(index).getByRole("button",{name:"解释一下",exact:true})).toBeEnabled();
  await page.getByTestId("chat-message").nth(2).scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(directory,"demo-mobile.png")});
  await page.setViewportSize({width:1440,height:900});
  await page.getByTestId("chat-message").nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(directory,"demo-desktop.png")});
  expect(report.modelRoutes+report.imageRoutes+report.sourceLoads).toBe(0);report.passed=true;
}finally{
  try{report.ownRoomClosed=(await owned.close()).closed;expect(report.ownRoomClosed).toBe(true);}
  catch(error){report.passed=false;throw error;}
  finally{await context.close();await browser.close();report.recordedAt=new Date().toISOString();
    await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));}
}
