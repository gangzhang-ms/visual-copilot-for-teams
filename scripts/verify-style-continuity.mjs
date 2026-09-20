import {readFile,writeFile,mkdir,readdir} from "node:fs/promises";
import {resolve,relative,join,basename} from "node:path";
import {createHash} from "node:crypto";
import {chromium,expect} from "@playwright/test";
import {ownedBrowserSession} from "./local-browser-session.mjs";

const root=resolve("dist-chat-style-continuity"),origin="http://127.0.0.1:4371";
const directory=resolve(".local","visual-context","style-continuity-runtime");
const report={passed:false,paidCalls:0,externalRequests:0,blockedProviderActions:0,startedAt:new Date().toISOString()};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const check=(value,message)=>{if(!value)throw new Error(message);};
const save=(name,data)=>writeFile(resolve(directory,name),JSON.stringify(data,null,2));
await mkdir(directory,{recursive:true});
async function manifest(root){
  const files=[];
  async function visit(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const path=join(folder,entry.name);
      if(entry.isDirectory())await visit(path);
      else{const bytes=await readFile(path);files.push({path:relative(root,path),bytes:bytes.length,sha256:hash(bytes)});}
    }
  }
  await visit(join(root,"client"));await visit(join(root,"server"));files.sort((a,b)=>a.path.localeCompare(b.path));
  return {root,sha256:hash(JSON.stringify(files)),files};
}
const browser=await chromium.launch({channel:"msedge"});
const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin);
try{
  const old=await manifest(resolve("dist-chat-compact-explain"));
  const receipt=JSON.parse(await readFile(resolve(".local","visual-context","compact-explain-runtime","build-manifest.json"),"utf8"));
  check(old.sha256===receipt.sha256,"4370-build-changed");report.preserved4370Sha256=old.sha256;
  const current=await manifest(root);await save("build-manifest.json",current);report.buildSha256=current.sha256;
  report.backendChanges=current.files.filter(f=>/^server[\\/]/.test(f.path)&&!old.files.some(o=>o.path===f.path&&o.sha256===f.sha256)).map(f=>f.path);
  report.removedBackendFiles=old.files.filter(f=>/^server[\\/]/.test(f.path)&&!current.files.some(c=>c.path===f.path)).map(f=>f.path);
  report.previousHealth=(await page.request.get("http://127.0.0.1:4370/healthz")).status();
  await owned.start();
  await page.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalRequests++;return route.abort();}
    if(/\/local\/(?:message|review|process|emoji\/suggest|catalog\/load|generation\/(?:review|process|batch\/(?:review|start|process|source\/retry)))$/.test(url.pathname)){
      report.blockedProviderActions++;return route.abort();
    }
    return route.continue();
  });
  await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  const state=()=>page.evaluate(async()=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    return(await fetch("/local/state",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"})).json();
  });
  const before=await state();report.providerRequestsBefore=before.providerRequests;
  await page.getByRole("button",{name:"Start demo",exact:true}).click();await expect(page.getByTestId("chat-message")).toHaveCount(9);
  const room=await state();report.messageCount=room.messages.length;check(room.contextualCreation&&room.emojiExpressions,"feature-gates");
  report.languages=[];
  for(const language of ["en","zh-CN"]){
    const en=language==="en";await page.getByLabel("Language / 语言").selectOption(language);
    await page.locator(".local-tabs").getByRole("button",{name:en?"Express":"帮我表达",exact:true}).click();
    await page.getByRole("radio",{name:en?"Create a new image":"生成新图",exact:true}).check();
    const options=page.locator(".creation-advanced");
    if(await options.getAttribute("open")===null)await options.locator(":scope > summary").click();
    const select=page.getByLabel(en?"Expression style":"表达风格",{exact:true});
    await select.selectOption("auto");
    await expect(select.locator('option[value="auto"]')).toHaveText(en?"Match reply context":"匹配回复上下文");
    await page.getByLabel(en?"Visual context (optional override)":"图片上下文（可选指定）",{exact:true}).selectOption(room.messages[1].id);
    await expect(page.locator(".reply-target-cue")).toContainText("Maya");
    await expect(page.locator(".reply-style-policy")).toContainText(en?"not the medium":"不默认更换媒介");
    await select.selectOption("light-comic");
    await expect(page.locator(".reply-style-policy")).toContainText(en?"Explicit style selected":"已明确选择风格");
    await select.selectOption("auto");
    await expect(page.locator(".generation-batch")).toHaveCount(0);
    await page.screenshot({path:resolve(directory,`${language}-desktop.png`),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"narrow-overflow");
    await page.screenshot({path:resolve(directory,`${language}-narrow.png`),fullPage:true});
    report.languages.push({language,autoLabel:await select.locator('option[value="auto"]').textContent(),replyTarget:await page.locator(".reply-target-cue").innerText()});
    await page.setViewportSize({width:1440,height:1100});
  }
  const after=await state();report.providerRequestsAfter=after.providerRequests;
  check(before.providerRequests===after.providerRequests&&report.externalRequests===0&&report.blockedProviderActions===0,"unexpected-call");
  check(after.messages.length===9,"unexpected-send");
  for(const file of current.files.filter(f=>/^client[\\/]assets[\\/].*\.(js|css)$/.test(f.path))){
    const response=await page.request.get(origin+"/assets/"+basename(file.path));
    check(response.ok()&&hash(await response.body())===file.sha256,"served-client-drift");
  }
  const html=current.files.find(f=>f.path===join("client","local-chat.html"));
  check(hash(await(await page.request.get(origin+"/chat")).body())===html.sha256,"served-html-drift");
  report.passed=true;
}catch(error){report.failure=error instanceof Error?error.message:"verification-failed";process.exitCode=1;}
finally{
  try{report.cleanup=await owned.close();check(report.cleanup.closed,"owned-room-not-closed");}
  catch(error){report.passed=false;report.cleanupFailure=error instanceof Error?error.message:"cleanup-failed";process.exitCode=1;}
  await context.close();await browser.close();await save("report.json",report);
  console.log(JSON.stringify({passed:report.passed,buildSha256:report.buildSha256,failure:report.failure,cleanupFailure:report.cleanupFailure,evidence:directory}));
}
