import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import sharp from "sharp";
import {ownedBrowserSession} from "./local-browser-session.mjs";
if(process.argv.slice(2).some(arg=>arg!=="--emoji"))throw new Error("Only --emoji is supported");
const emojiMode=process.argv.includes("--emoji");
const origin=emojiMode?"http://127.0.0.1:4328":"http://127.0.0.1:4327";
const directory=resolve(".local","visual-context",emojiMode?"emoji-explain-validation":"visual-explain-validation");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin);
const report={origin,recordedAt:"",mocked:false,modelRoutes:0,imageRoutes:0,sourceLoads:0,messageStatuses:[],
  rejectedTextReviews:[],imageExplainEnabled:false,emojiExplainEnabled:false,textActionsHidden:false,ownRoomClosed:false,passed:false};
page.on("request",r=>{const path=new URL(r.url()).pathname;if(path==="/local/process")report.modelRoutes++;
  if(path==="/local/generation/process")report.imageRoutes++;if(path==="/local/catalog/load")report.sourceLoads++;});
async function add(text){
  await page.getByLabel("Message",{exact:true}).fill(text);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/message");
  await page.getByRole("button",{name:"Add locally",exact:true}).click();
  const status=(await response).status();report.messageStatuses.push(status);expect(status).toBe(200);
}
try{
  await owned.start();await page.goto(origin+"/chat");
  await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  await add("Self-authored text context, not an Explain target.");
  await add("\u{1f642}\u{1f49c}");
  for(let i=0;i<(emojiMode?1:2);i++){
    const bubble=page.getByTestId("chat-message").nth(i);
    await expect(bubble.getByRole("button",{name:"Explain",exact:true})).toHaveCount(0);
    const trigger=bubble.getByRole("button",{name:"Message actions",exact:true});
    await trigger.click();
    await expect(page.getByRole("menuitem",{name:"Explain this message",exact:true})).toHaveCount(0);
    await expect(page.getByRole("menuitem",{name:"Edit message",exact:true})).toBeEnabled();
    await expect(page.getByRole("menuitem",{name:"Remove message",exact:true})).toBeEnabled();
    await page.keyboard.press("Escape");await expect(trigger).toBeFocused();
  }
  if(emojiMode){
    const bubble=page.getByTestId("chat-message").last();
    await expect(bubble.getByRole("button",{name:"Explain",exact:true})).toBeEnabled();
    await bubble.getByRole("button",{name:"Message actions",exact:true}).click();
    await expect(page.getByRole("menuitem",{name:"Explain this message",exact:true})).toBeEnabled();
    await page.keyboard.press("Escape");report.emojiExplainEnabled=true;
    await add("Friendly \u{1f44d}\u{1f3fd}");
    await expect(page.getByTestId("chat-message").last().getByRole("button",{name:"Explain",exact:true})).toBeEnabled();
  }
  report.textActionsHidden=true;
  report.rejectedTextReviews=await page.evaluate(async(emojiMode)=>{
    const session=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const results=[];
    for(const message of emojiMode?session.messages.slice(0,1):session.messages){
      const response=await fetch("/local/review",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
        body:JSON.stringify({revision:session.revision,command:"explainVisual",selectedId:message.id,canExplain:true,input:{
          version:0,intent:"Synthetic boundary check only",context:[],preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}}})});
      results.push({status:response.status,code:(await response.json()).code});
    }
    return results;
  },emojiMode);
  expect(report.rejectedTextReviews).toEqual(Array.from({length:emojiMode?1:2},()=>({status:400,code:"local-visual-required"})));
  const buffer=await sharp({create:{width:64,height:64,channels:3,background:"#426ca5"}}).png().toBuffer();
  await page.getByLabel("Attach visual").setInputFiles({name:"synthetic-square.png",mimeType:"image/png",buffer});
  await expect(page.getByAltText("Attachment preview",{exact:true})).toBeVisible();
  await add("Self-authored square with caption; no inference requested by this check.");
  await expect(page.getByTestId("chat-message").last().getByRole("button",{name:"Explain",exact:true})).toBeEnabled();
  report.imageExplainEnabled=true;
  await page.screenshot({path:resolve(directory,"desktop-no-inference.png")});
  await page.getByLabel("Language / 语言").selectOption("zh-CN");await page.setViewportSize({width:320,height:900});
  if(await page.getByRole("button",{name:"收起 AI 面板",exact:true}).isVisible())await page.getByRole("button",{name:"收起 AI 面板",exact:true}).click();
  await expect(page.getByTestId("chat-message").getByRole("button",{name:"解释一下",exact:true})).toHaveCount(emojiMode?3:1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:resolve(directory,"mobile-no-inference.png")});
  expect(report.modelRoutes+report.imageRoutes+report.sourceLoads).toBe(0);report.passed=true;
}finally{
  try{report.ownRoomClosed=(await owned.close()).closed;expect(report.ownRoomClosed).toBe(true);}
  catch(error){report.passed=false;throw error;}
  finally{await context.close();await browser.close();report.recordedAt=new Date().toISOString();
    await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));}
}
