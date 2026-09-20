import {readFile,writeFile,mkdir,readdir} from "node:fs/promises";
import {resolve,relative,join,basename} from "node:path";
import {createHash} from "node:crypto";
import {chromium,expect} from "@playwright/test";
import sharp from "sharp";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const enlarge=process.argv[2]==="--enlarge",polished=enlarge||process.argv[2]==="--polish",messageCount=polished?9:8;
const origin=`http://127.0.0.1:${enlarge?4365:polished?4364:4362}`,root=resolve(enlarge?"dist-chat-emoji-enlarge":polished?"dist-chat-demo-polish-fixed":"dist-chat-combined-demo"),
  dir=resolve(".local","visual-context",enlarge?"emoji-enlarge-runtime":polished?"demo-polish-runtime":"combined-demo-runtime");
const report={origin,root,startedAt:new Date().toISOString(),passed:false,providerActions:0,externalRequests:0,closed:false,
  liveAiAcceptance:"Not performed or authorized for this demo reordering; model behavior is covered by offline fixtures."};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const check=(ok,code)=>{if(!ok)throw new Error(code);};
const save=(name,value)=>writeFile(resolve(dir,name),JSON.stringify(value,null,2));
let browser,page,owned;
await mkdir(dir,{recursive:true});
try{
  const files=[];
  async function visit(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const path=join(folder,entry.name);
      if(entry.isDirectory())await visit(path);
      else{const bytes=await readFile(path);files.push({path:relative(root,path),bytes:bytes.length,sha256:hash(bytes)});}
    }
  }
  await visit(resolve(root,"client"));await visit(resolve(root,"server"));files.sort((a,b)=>a.path.localeCompare(b.path));
  report.buildSha256=hash(JSON.stringify(files));await save("build-manifest.json",{root,sha256:report.buildSha256,files});
  browser=await chromium.launch({channel:"msedge"});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});page=await context.newPage();page.setDefaultTimeout(30_000);
  owned=ownedBrowserSession(page,origin);await owned.start();
  report.health=await(await page.request.get(origin+"/healthz")).json();
  check(report.health.ready&&report.health.model&&report.health.webImageSearch.configured,"runtime-unready");
  await page.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalRequests++;return route.abort();}
    if(/\/local\/(?:emoji\/suggest|process|catalog\/load|generation\/(?:process|batch\/(?:start|process|source\/retry)))$/.test(url.pathname)){
      report.providerActions++;return route.abort();
    }
    return route.continue();
  });
  await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  async function state(){
    return page.evaluate(async()=>{
      const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
      return(await fetch("/local/state",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"})).json();
    });
  }
  const before=await state();check(before.emojiExpressions&&before.contextualCreation,"feature-wiring");
  await expect(page.locator(".local-empty .local-primary")).toHaveCount(1);
  await expect(page.getByRole("button",{name:"Start demo",exact:true})).toBeEnabled();
  await expect(page.getByRole("button",{name:/Start emoji understanding|Load emoji understanding/})).toHaveCount(0);
  await page.screenshot({path:resolve(dir,"single-entry.png"),fullPage:true});
  await page.getByRole("button",{name:"Start demo",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(messageCount);
  const room=await state(),mapping=[];
  for(const [index,message] of room.messages.entries()){
    let media;
    if(message.attachment){
      const bytes=Buffer.from(message.attachment.dataUrl.split(",")[1],"base64"),metadata=await sharp(bytes,{animated:true}).metadata();
      media={category:message.attachment.category,sha256:hash(bytes),bytes:bytes.length,width:metadata.width,
        height:metadata.pageHeight??metadata.height,frames:metadata.pages??1};
    }
    mapping.push({index,id:message.id,speaker:message.speaker,text:message.text,marker:message.demoMedia??null,media});
  }
  check(mapping[1].marker==="user-reference"&&mapping[2].marker==="local-motion"
    &&[3,4,6].every(i=>mapping[i].marker==="custom-emoji"),"media-types");
  check(mapping[2].media.frames===12&&mapping[5].text.includes("👩🏽‍💻")&&mapping[7].text.includes("🙏🙂"),"exact-demo-content");
  if(polished){
    check(mapping[0].text.startsWith("Proposal:")&&mapping[2].text.includes("if it fails")
      &&mapping[3].text.includes("deploy alerts")&&mapping[3].text.includes("portal can wait")
      &&mapping[8].text.includes("pilot dashboards"),"story-causality");
    await expect(page.locator(".custom-emoji-artwork > span, .custom-emoji-artwork > p")).toHaveCount(0);
    report.artworkHeights=await page.locator(".custom-emoji-artwork").evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().height));
    check(report.artworkHeights.every(height=>height<=60),"compact-artwork");
  }
  await save("message-media-map.json",mapping);report.messageCount=mapping.length;
  await page.locator(".local-messages").evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:resolve(dir,"combined-thread-top.png"),fullPage:true});
  report.customIcons=await page.locator(".custom-emoji-icon").evaluateAll(images=>images.map(el=>({
    width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,naturalWidth:el.naturalWidth
  })));
  check(report.customIcons.length===3&&report.customIcons.every(i=>i.width===48&&i.height===48&&i.naturalWidth===384),"custom-size");
  if(enlarge){
    report.cues=[];
    for(const [index,button] of (await page.locator(".custom-emoji-trigger").all()).entries()){
      await expect(button).toHaveText("Enlarge");
      await expect(button.locator(".custom-emoji-caption")).toBeVisible();
      const size=await button.boundingBox();check(size.width<=120&&size.height===58,"compact-enlarge-cue");
      report.cues.push({index,width:size.width,height:size.height,label:await button.innerText()});
      report.cueAction={index,action:"caption-click"};
      await button.locator(".custom-emoji-caption").click();
      const preview=page.getByRole("dialog",{name:"Custom emoji preview",exact:true});await expect(preview).toBeVisible();
      await preview.getByRole("button",{name:"Close",exact:true}).click();await expect(preview).toHaveCount(0);await expect(button).toBeFocused();
      report.cueAction={index,action:"keyboard-enter"};
      await page.keyboard.press("Enter");await expect(preview).toBeVisible();
      await page.keyboard.press("Escape");await expect(preview).toHaveCount(0);await expect(button).toBeFocused();
    }
    const reference=JSON.parse(await readFile(resolve(".local","visual-context","demo-polish-runtime","build-manifest.json"),"utf8"));
    const server=files.filter(f=>/^server[\\/]/.test(f.path)),oldServer=reference.files.filter(f=>/^server[\\/]/.test(f.path));
    check(JSON.stringify(server)===JSON.stringify(oldServer),"backend-changed");
    report.backendMatches4364=true;
  }
  await page.getByRole("button",{name:"Enlarge custom emoji",exact:true}).nth(1).click();
  const dialog=page.getByRole("dialog",{name:"Custom emoji preview",exact:true});await expect(dialog).toBeVisible();
  if(polished){await expect(dialog.getByRole("heading")).toHaveText("Emoji preview");await expect(dialog.locator("p")).toHaveCount(0);}
  check((await dialog.locator("img").boundingBox()).width===256,"preview-size");
  await page.screenshot({path:resolve(dir,"custom-preview.png"),fullPage:true});await page.keyboard.press("Escape");
  const inspector=page.getByTestId("chat-message").nth(5).locator(".emoji-inspector");
  await inspector.locator("summary").click();await expect(inspector.locator(".emoji-enlarged")).toHaveText("👩🏽‍💻");
  if(polished){await expect(inspector.locator("summary")).toHaveText("Enlarge emoji (1)");await expect(inspector.locator(".emoji-identity-caution")).toContainText("not an AI explanation");}
  report.glyphFontPx=await inspector.locator(".emoji-enlarged").evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  check(report.glyphFontPx===96,"unicode-enlargement");
  await page.locator(".local-messages").evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await page.screenshot({path:resolve(dir,"combined-thread-bottom.png"),fullPage:true});
  await page.locator(".local-tabs").getByRole("button",{name:"Express",exact:true}).click();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await page.locator(".creation-advanced > summary").click();
  await page.getByLabel("Visual context (optional override)",{exact:true}).selectOption(room.messages[1].id);
  await expect(page.locator(".reply-target-cue")).toContainText("Maya");
  await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
  await page.getByLabel("Reply to message",{exact:true}).selectOption(room.messages[1].id);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("A cautious acknowledgment");
  await expect(page.getByRole("button",{name:"Suggest emoji",exact:true})).toBeEnabled();
  await page.screenshot({path:resolve(dir,"emoji-express-ready.png"),fullPage:true});
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  if(enlarge){
    await expect(page.locator(".custom-emoji-caption")).toHaveText(["放大","放大","放大"]);
    await page.getByRole("button",{name:"放大自定义 emoji",exact:true}).first().click();
    const preview=page.getByRole("dialog",{name:"自定义 emoji 预览",exact:true});await expect(preview).toBeVisible();
    await preview.getByRole("button",{name:"关闭",exact:true}).click();
  }
  await expect(page.getByRole("button",{name:"载入演示",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"推荐 emoji",exact:true})).toBeVisible();
  await page.screenshot({path:resolve(dir,"chinese-controls.png"),fullPage:true});
  const after=await state();report.providerRequestsBefore=before.providerRequests;report.providerRequestsAfter=after.providerRequests;
  check(before.providerRequests===after.providerRequests&&report.providerActions===0&&report.externalRequests===0,"unexpected-provider-action");
  check(after.messages.length===messageCount,"automatic-send");
  for(const file of files.filter(f=>/^client[\\/]assets[\\/].*\.(js|css)$/.test(f.path))){
    const response=await page.request.get(origin+"/assets/"+basename(file.path));
    check(response.ok()&&hash(await response.body())===file.sha256,"served-client-drift");
  }
  const html=files.find(f=>f.path===["client","local-chat.html"].join("\\"));
  check(html&&hash(await(await page.request.get(origin+"/chat")).body())===html.sha256,"served-html-drift");
  const budgets=[];
  for(const language of ["en","zh-CN"]){
    const proof=JSON.parse(await readFile(resolve(".local","visual-context",polished?"demo-polish-offline":"combined-demo-offline",`explain-bindings-${language}.json`),"utf8"));
    check(proof.paidCalls===0&&proof.proofs.length===7&&proof.proofs.every(p=>p.contextCount===messageCount&&p.inputTokens<=8500),"offline-binding-proof");
    budgets.push({language,targets:proof.proofs.map(p=>({index:p.index,target:p.target,inputUpperBound:p.inputTokens,contexts:p.contextCount,frames:p.sampleOwners.length}))});
  }
  await save("validated-budget-and-bindings.json",{paidCalls:0,fixtureOnly:true,inputLimit:8500,budgets});
  report.passed=true;
}catch(error){
  report.failure=error instanceof Error?error.message:"runtime-check-failed";process.exitCode=1;
  if(page)await page.screenshot({path:resolve(dir,"failure.png"),fullPage:true}).catch(()=>{report.screenshotFailed=true;});
}finally{
  await save("report.json",report);
  if(owned)try{report.cleanup=await owned.close();report.closed=report.cleanup.closed;}catch{report.cleanupFailed=true;process.exitCode=1;}
  if(browser)await browser.close();
  await save("report.json",report);console.log(JSON.stringify(report));
}
