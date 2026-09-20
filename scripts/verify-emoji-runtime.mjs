import {readFile,writeFile,mkdir,readdir} from "node:fs/promises";
import {resolve,basename,join,relative} from "node:path";
import {createHash} from "node:crypto";
import {chromium,expect} from "@playwright/test";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const custom=process.argv[2]==="--custom",referenceFix=custom||process.argv[2]==="--reference-fix",recognition=referenceFix||process.argv[2]==="--recognition";
const origin=`http://127.0.0.1:${custom?4361:referenceFix?4360:recognition?4359:4358}`,
  root=resolve(custom?"dist-chat-custom-emoji-demo":referenceFix?"dist-chat-emoji-reference-fix":recognition?"dist-chat-emoji-recognition":"dist-chat-emoji-express"),
  dir=resolve(".local","visual-context",custom?"custom-emoji-demo-runtime":referenceFix?"emoji-reference-fix-runtime":recognition?"emoji-recognition-runtime":"emoji-runtime");
const report={origin,root,passed:false,providerActions:0,externalRequests:0,closed:false};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const check=(ok,code)=>{if(!ok)throw new Error(code);};
let browser,owned,page;
await mkdir(dir,{recursive:true});
try{
  let manifest;
  if(recognition&&!referenceFix){
    const files=[];
    async function visit(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
      const path=join(folder,entry.name);if(entry.isDirectory())await visit(path);else{
        const bytes=await readFile(path);files.push({path:relative(root,path),bytes:bytes.length,sha256:hash(bytes)});
      }
    }}
    await visit(resolve(root,"client"));await visit(resolve(root,"server"));files.sort((a,b)=>a.path.localeCompare(b.path));
    manifest={root,sha256:hash(JSON.stringify(files)),files};
    await writeFile(resolve(dir,"build-manifest.json"),JSON.stringify(manifest,null,2));
  }else manifest=JSON.parse(await readFile(resolve(".local","visual-context",    custom?"custom-emoji-demo-offline":referenceFix?"emoji-reference-fix-live":"emoji-expression-live","build-manifest.json"),"utf8"));
  for(const file of manifest.files)check(hash(await readFile(resolve(root,file.path)))===file.sha256,"build-drift");
  report.buildSha256=manifest.sha256;
  if(custom)report.acceptance="Readiness only, with no AI call. Separately authorized live acceptance is recorded in custom-emoji-final-live.";
  browser=await chromium.launch({channel:"msedge"});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});page=await context.newPage();
  owned=ownedBrowserSession(page,origin);await owned.start();
  report.health=await(await page.request.get(origin+"/healthz")).json();
  check(report.health.ready===true&&report.health.model===true&&report.health.webImageSearch.configured===true,"runtime-not-ready");
  await page.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalRequests++;return route.abort();}
    if(/\/local\/(?:emoji\/suggest|process|catalog\/load|generation\/(?:process|batch\/(?:start|process|source\/retry)))$/.test(url.pathname)){
      report.providerActions++;return route.abort();
    }
    return route.continue();
  });
  await page.goto(origin+"/chat");
  await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  async function state(){
    return page.evaluate(async()=>{
      const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
      return(await fetch("/local/state",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"})).json();
    });
  }
  const before=await state();check(before.emojiExpressions===true&&before.contextualCreation===true,"feature-wiring");
  if(custom){
    await page.getByRole("button",{name:"Start emoji understanding demo",exact:true}).click();
    await expect(page.getByTestId("chat-message")).toHaveCount(7);
    await expect(page.locator(".custom-emoji-icon")).toHaveCount(3);
    report.demoIcons=await page.locator(".custom-emoji-icon").evaluateAll(images=>images.map(el=>({
      width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,naturalWidth:el.naturalWidth
    })));
    check(report.demoIcons.every(icon=>icon.width===48&&icon.height===48&&icon.naturalWidth===384),"custom-emoji-size");
    await page.screenshot({path:resolve(dir,"custom-demo.png"),fullPage:true});
    await page.getByRole("button",{name:"Enlarge custom emoji",exact:true}).first().click();
    const dialog=page.getByRole("dialog",{name:"Custom emoji preview",exact:true});await expect(dialog).toBeVisible();
    await page.screenshot({path:resolve(dir,"custom-preview.png"),fullPage:true});
    await dialog.getByRole("button",{name:"Close",exact:true}).click();
    report.demoMessages=7;
  }
  if(recognition){
    await page.getByLabel("Message",{exact:true}).fill("Owned symbol check 🙏🙂👩🏽‍💻🇺🇳1️⃣❤️");
    await page.getByRole("button",{name:"Add locally",exact:true}).click();
    const inspector=page.getByTestId("chat-message").filter({hasText:"Owned symbol check"}).locator(".emoji-inspector");
    await inspector.locator("summary").click();
    await expect(inspector.locator(".emoji-enlarged")).toHaveText("🙏");
    report.glyphFontPx=await inspector.locator(".emoji-enlarged").evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
    check(report.glyphFontPx>=80,"enlargement-size");
    await expect(inspector.locator(".emoji-identity-name")).toContainText("Folded hands");
    await page.screenshot({path:resolve(dir,"enlarged-english.png"),fullPage:true});
    await inspector.getByRole("button",{name:"3: Woman technologist: medium skin tone",exact:true}).click();
    await expect(inspector.locator(".emoji-enlarged")).toHaveText("👩🏽‍💻");
    await page.getByLabel("Language / 语言").selectOption("zh-CN");
    await expect(inspector.locator(".emoji-identity-name")).toContainText("女性技术人员：中等肤色");
    await page.screenshot({path:resolve(dir,"enlarged-chinese.png"),fullPage:true});
    await page.getByLabel("Language / 语言").selectOption("en");
    report.localSelectionExact=true;
  }
  await page.locator(".local-tabs").getByRole("button",{name:"Express",exact:true}).click();
  await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Gentle encouragement");
  await expect(page.getByRole("button",{name:"Suggest emoji",exact:true})).toBeEnabled();
  await page.screenshot({path:resolve(dir,"ready-english.png"),fullPage:true});
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await expect(page.getByRole("button",{name:"推荐 emoji",exact:true})).toBeVisible();
  await page.screenshot({path:resolve(dir,"ready-chinese.png"),fullPage:true});
  const after=await state();
  report.providerRequestsBefore=before.providerRequests;report.providerRequestsAfter=after.providerRequests;
  check(before.providerRequests===after.providerRequests&&report.providerActions===0&&report.externalRequests===0,"unexpected-call");
  for(const file of manifest.files.filter(f=>/^client[\\/]assets[\\/].*\.(js|css)$/.test(f.path))){
    const response=await page.request.get(origin+"/assets/"+basename(file.path));
    check(response.ok()&&hash(await response.body())===file.sha256,"served-client-drift");
  }
  const html=manifest.files.find(f=>f.path===["client","local-chat.html"].join("\\"));
  check(html&&hash(await(await page.request.get(origin+"/chat")).body())===html.sha256,"served-html-drift");
  report.passed=true;
}catch(error){
  report.failure=error instanceof Error?error.message:"runtime-check-failed";process.exitCode=1;
  if(page){
    report.alerts=await page.getByRole("alert").allTextContents();
    await page.screenshot({path:resolve(dir,"failure.png"),fullPage:true});
  }
}
finally{
  await writeFile(resolve(dir,"report.json"),JSON.stringify(report,null,2));
  if(owned)try{report.cleanup=await owned.close();report.closed=report.cleanup.closed;}catch{report.cleanupFailed=true;process.exitCode=1;}
  if(browser)await browser.close();
  await writeFile(resolve(dir,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
