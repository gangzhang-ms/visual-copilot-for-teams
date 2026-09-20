import {readFile,writeFile,mkdir,readdir} from "node:fs/promises";
import {resolve,relative,join,basename} from "node:path";
import {createHash} from "node:crypto";
import {chromium,expect} from "@playwright/test";
import {ownedBrowserSession} from "./local-browser-session.mjs";

const compact=process.argv[2]==="--compact",visual=compact||process.argv[2]==="--visual",consistent=visual||process.argv[2]==="--consistent",inline=consistent||process.argv[2]==="--inline",
  previousPort=compact?4369:visual?4368:consistent?4367:inline?4366:4365,currentPort=compact?4370:visual?4369:consistent?4368:inline?4367:4366;
const dir=resolve(".local","visual-context",compact?"compact-explain-runtime":visual?"visual-inline-runtime":consistent?"emoji-consistent-runtime":inline?"emoji-inline-runtime":"emoji-disclosure-runtime");
const report={startedAt:new Date().toISOString(),passed:false,paidCalls:0,runtimes:[]};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const check=(ok,code)=>{if(!ok)throw new Error(code);};
const save=(name,data)=>writeFile(resolve(dir,name),JSON.stringify(data,null,2));
await mkdir(dir,{recursive:true});
async function manifest(root){
  const files=[];
  async function visit(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const path=join(folder,entry.name);
      if(entry.isDirectory())await visit(path);
      else{const bytes=await readFile(path);files.push({path:relative(root,path),bytes:bytes.length,sha256:hash(bytes)});}
    }
  }
  await visit(resolve(root,"client"));await visit(resolve(root,"server"));files.sort((a,b)=>a.path.localeCompare(b.path));
  return {root,sha256:hash(JSON.stringify(files)),files};
}
const browser=await chromium.launch({channel:"msedge"});
try{
  const previous=await manifest(resolve(compact?"dist-chat-visual-inline":visual?"dist-chat-emoji-consistent":consistent?"dist-chat-emoji-inline":inline?"dist-chat-emoji-disclosure":"dist-chat-emoji-enlarge"));
  const receipt=JSON.parse(await readFile(resolve(".local","visual-context",compact?"visual-inline-runtime":visual?"emoji-consistent-runtime":consistent?"emoji-inline-runtime":inline?"emoji-disclosure-runtime":"emoji-enlarge-runtime","build-manifest.json"),"utf8"));
  check(previous.sha256===receipt.sha256,`${previousPort}-build-changed`);
  const current=await manifest(resolve(compact?"dist-chat-compact-explain":visual?"dist-chat-visual-inline":consistent?"dist-chat-emoji-consistent":inline?"dist-chat-emoji-inline":"dist-chat-emoji-disclosure"));
  check(JSON.stringify(current.files.filter(f=>/^server[\\/]/.test(f.path)))===
    JSON.stringify(previous.files.filter(f=>/^server[\\/]/.test(f.path))),"backend-changed");
  report[`backendMatches${previousPort}`]=true;report.buildSha256=current.sha256;report[`preserved${previousPort}Sha256`]=previous.sha256;
  await save("build-manifest.json",current);
  for(const [port,build] of [[previousPort,previous],[currentPort,current]]){
    const origin=`http://127.0.0.1:${port}`,modern=port===currentPort;
    const r={port,origin,externalRequests:0,providerActions:0,closed:false};report.runtimes.push(r);
    const context=await browser.newContext({viewport:{width:1440,height:1100}});
    const page=await context.newPage();page.setDefaultTimeout(20_000);
    const owned=ownedBrowserSession(page,origin);
    const state=()=>page.evaluate(async()=>{
      const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
      return(await fetch("/local/state",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"})).json();
    });
    try{
      await owned.start();
      r.health=await(await page.request.get(origin+"/healthz")).json();check(r.health.ready,"not-ready");
      await page.route("**/*",route=>{
        const url=new URL(route.request().url());
        if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){r.externalRequests++;return route.abort();}
        if(/\/local\/(?:message|emoji\/suggest|process|catalog\/load|generation\/(?:process|batch\/(?:start|process|source\/retry)))$/.test(url.pathname)){
          r.providerActions++;return route.abort();
        }
        return route.continue();
      });
      await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
      const before=await state();r.providerRequestsBefore=before.providerRequests;
      await expect(page.locator(".local-empty .local-primary")).toHaveCount(1);
      await page.getByRole("button",{name:"Start demo",exact:true}).click();await expect(page.getByTestId("chat-message")).toHaveCount(9);
      const room=await state();
      r.messages=room.messages.map(m=>({speaker:m.speaker,text:m.text,marker:m.demoMedia??null,
        imageSha256:m.attachment?hash(Buffer.from(m.attachment.dataUrl.split(",")[1],"base64")):null}));
      check(room.emojiExpressions&&room.contextualCreation&&room.messages[5].text.includes("👩🏽‍💻")&&room.messages[7].text.includes("🙏🙂"),"demo-features");
      const row=page.getByTestId("chat-message").nth(4),custom=row.locator(".custom-emoji-artwork");
      r.closedBubble=await row.locator(".local-message-bubble").count()
        ?await row.locator(".local-message-bubble").boundingBox():await custom.locator("..").boundingBox();
      r.closedArtwork=await custom.boundingBox();
      await row.screenshot({path:resolve(dir,`${port}-closed.png`)});
      if(!modern){
        await custom.locator(".custom-emoji-trigger").click();
        if(inline){
          await expect(custom.locator(".custom-emoji-preview")).toBeVisible();
          await row.screenshot({path:resolve(dir,`${port}-open.png`)});
          await custom.locator(".custom-emoji-trigger").click();await expect(custom.locator(".custom-emoji-preview")).toHaveCount(0);
        }else{
          const dialog=page.getByRole("dialog",{name:"Custom emoji preview",exact:true});
          await expect(dialog).toBeVisible();await page.screenshot({path:resolve(dir,`${port}-open.png`),fullPage:true});
          await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
        }
      }else{
        r.languages=[];
        for(const language of ["en","zh-CN"]){
          await page.getByLabel("Language / 语言").selectOption(language);
          const details=page.locator(".emoji-enlargement"),summaries=details.locator(":scope > summary");
          const one=language==="en"?"Enlarge emoji (1)":"放大 emoji（1）",two=language==="en"?"Enlarge emoji (2)":"放大 emoji（2）";
          await expect(summaries).toHaveText(visual?[language==="en"?"Enlarge image":"放大图片",language==="en"?"Enlarge GIF":"放大 GIF",one,one,one,one,two]:[one,one,one,one,two]);
          await row.screenshot({path:resolve(dir,`${port}-${language}-closed.png`)});
          await expect(page.locator(".custom-emoji-caption, .custom-emoji-dialog, summary button, button button")).toHaveCount(0);
          const ids=await details.evaluateAll(nodes=>nodes.map(el=>el.id));
          check(new Set(ids).size===(visual?7:5),"duplicate-id");
          const styles=await summaries.evaluateAll(nodes=>nodes.map(el=>{
            const s=getComputedStyle(el);return {font:s.font,lineHeight:s.lineHeight,padding:s.padding,margin:s.margin,display:s.display,marker:s.listStyleType};
          }));
          check(styles.every(s=>JSON.stringify(s)===JSON.stringify(styles[0]))&&styles[0].marker==="disclosure-closed","different-summary-style");
          const l={language,labels:await summaries.allTextContents(),styles,panels:[],icons:[],initialAiRegions:[]};r.languages.push(l);
          for(const [i,disclosure] of (await details.all()).entries()){
            const summary=disclosure.locator("summary");
            await summary.focus();await page.keyboard.press("Enter");
            const panel=disclosure.locator(".emoji-enlargement-panel");await expect(panel).toBeVisible();await expect(summary).toBeFocused();
            if(inline){
              const explanation=panel.locator(".inline-emoji-explanation");
              await expect(explanation).toBeVisible();await expect(explanation.locator(".inline-emoji-result")).toHaveCount(0);
              await expect(explanation.getByRole("button",{name:language==="en"?"Explain with AI":"AI解释",exact:true})).toBeEnabled();
              await expect(explanation).toHaveAttribute("aria-busy","false");
              if(consistent){
                l.initialAiRegions.push(await explanation.innerText());
                await expect(panel.locator(".emoji-possible-uses,.emoji-identity-caution")).toHaveCount(0);
                await expect(explanation.locator(".inline-emoji-scope")).toContainText(visual&&i<2?(language==="en"?"message":"消息"):(language==="en"?"not only the previewed symbol":"而非仅当前预览的符号"));
              }
            }
            check(await summary.evaluate(el=>getComputedStyle(el).outlineStyle)==="solid","missing-focus");
            check(await summary.evaluate(el=>getComputedStyle(el).listStyleType)==="disclosure-open","missing-open-arrow");
            l.panels.push(await panel.evaluate(el=>{const s=getComputedStyle(el);return {padding:s.padding,border:s.border,background:s.background,borderRadius:s.borderRadius};}));
            const image=panel.locator(".custom-emoji-preview");
            if(await image.count()){
              const artwork=disclosure.locator(".."),button=artwork.locator(".custom-emoji-trigger"),icon=button.locator("img");
              check(await button.getAttribute("aria-controls")===await disclosure.getAttribute("id"),"control-binding");
              await expect(button).toHaveAttribute("aria-expanded","true");
              await expect(image).toHaveAttribute("src",await icon.getAttribute("src"));
              const size=await icon.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,native:el.naturalWidth}));
              check(size.width===48&&size.height===48&&size.native===384,"image-dimensions");l.icons.push(size);
              check((await image.boundingBox()).width===256,"preview-dimensions");
              check(await button.evaluate(el=>getComputedStyle(el).borderWidth)==="0px","thumbnail-border");
              if(i===1)await row.screenshot({path:resolve(dir,`${port}-${language}-open.png`)});
            }else if(visual&&i<2){
              const image=panel.locator(".message-visual-image"),artwork=disclosure.locator(".."),button=artwork.locator(".message-visual-trigger");
              await expect(image).toBeVisible();await expect(button).toHaveAttribute("aria-expanded","true");
              check(await button.getAttribute("aria-controls")===await disclosure.getAttribute("id"),"visual-control-binding");
              check(await image.getAttribute("src")===room.messages[i+1].attachment.dataUrl,"original-visual-source");
              const size=await image.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,native:el.naturalWidth,nativeHeight:el.naturalHeight,density:window.devicePixelRatio}));
              check(size.width<=size.native/size.density+.5&&Math.abs(size.width/size.height-size.native/size.nativeHeight)<.02,"visual-upscaled-or-stretched");
              if(i===1)check((await image.getAttribute("src")).startsWith("data:image/gif;"),"gif-became-static");
              l.visuals??=[];l.visuals.push(size);
              await artwork.screenshot({path:resolve(dir,`${port}-${language}-${i===1?"gif":"image"}-open.png`)});
            }else{
              check(await panel.locator(".emoji-enlarged").evaluate(el=>parseFloat(getComputedStyle(el).fontSize))===96,"glyph-size");
              const choices=panel.locator(".emoji-inspector-choices button");
              if(await choices.count()===2){
                await choices.nth(1).click();await expect(panel.locator(".emoji-enlarged")).toHaveText("🙂");
                await choices.first().click();await expect(panel.locator(".emoji-enlarged")).toHaveText("🙏");
              }else await expect(panel.locator(".emoji-enlarged")).toHaveText("👩🏽‍💻");
              const single=i===(visual?4:2);
              await page.getByTestId("chat-message").nth(single?5:7).screenshot({path:resolve(dir,`${port}-${language}-unicode-${single?"one":"two"}-open.png`)});
            }
            await summary.focus();await page.keyboard.press("Space");await expect(panel).toHaveCount(0);await expect(summary).toBeFocused();
          }
          check(l.panels.every(s=>JSON.stringify(s)===JSON.stringify(l.panels[0])),"different-panel-style");
          if(consistent){
            const emojiRegions=visual?l.initialAiRegions.slice(2):l.initialAiRegions;
            check(emojiRegions.length===5&&emojiRegions.every(text=>text===emojiRegions[0]),"different-initial-ai-region");
            if(visual)check(l.initialAiRegions.length===7&&l.initialAiRegions[0]===l.initialAiRegions[1],"different-visual-ai-region");
          }
          for(const artwork of await page.locator(".custom-emoji-artwork").all()){
            const button=artwork.locator(".custom-emoji-trigger"),image=artwork.locator(".custom-emoji-preview");
            await button.locator("img").click();await expect(image).toBeVisible();
            await button.click();await expect(image).toHaveCount(0);await expect(button).toBeFocused();
            await page.keyboard.press("Enter");await expect(image).toBeVisible();
            await page.keyboard.press("Space");await expect(image).toHaveCount(0);await expect(button).toBeFocused();
          }
          await page.setViewportSize({width:390,height:844});
          await page.getByRole("button",{name:language==="en"?"Hide AI panel":"收起 AI 面板",exact:true}).click();
          l.narrow=[];
          for(const [index,disclosure] of (await details.all()).entries()){
            const summary=disclosure.locator("summary");await summary.click();
            const panel=disclosure.locator(".emoji-enlargement-panel");await expect(panel).toBeVisible();
            const rect=await panel.boundingBox();check(rect.x>=0&&rect.x+rect.width<=390,"narrow-overflow");l.narrow.push(rect);
            if(index===1)await row.screenshot({path:resolve(dir,`${port}-${language}-narrow.png`)});
            await summary.click();await expect(panel).toHaveCount(0);
          }
          await row.getByRole("button",{name:language==="en"?"Message actions":"消息操作",exact:true}).click();
          await page.getByRole("menuitem",{name:language==="en"?"Media information":"素材信息",exact:true}).click();
          await expect(page.getByRole("dialog")).toContainText(language==="en"?"locally authored":"本地绘制");
          await page.keyboard.press("Escape");await expect(page.locator("dialog[open]")).toHaveCount(0);
          await page.setViewportSize({width:1440,height:1100});
          await page.getByRole("button",{name:language==="en"?"Open AI panel":"打开 AI 面板",exact:true}).click();
        }
        await page.getByLabel("Language / 语言").selectOption("en");
        await page.locator(".local-tabs").getByRole("button",{name:"Express",exact:true}).click();
        await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
        await page.getByLabel("Reply to message",{exact:true}).selectOption(room.messages[1].id);
        await page.getByRole("radio",{name:"Images / GIFs",exact:true}).check();
        await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
        await expect(page.getByLabel("Reply to message",{exact:true})).toHaveValue(room.messages[1].id);
      }
      const after=await state();r.providerRequestsAfter=after.providerRequests;
      check(r.providerRequestsBefore===r.providerRequestsAfter&&r.providerActions===0&&r.externalRequests===0,"unexpected-call");
      check(after.messages.length===9,"unexpected-send");
      for(const file of build.files.filter(f=>/^client[\\/]assets[\\/].*\.(js|css)$/.test(f.path))){
        const response=await page.request.get(origin+"/assets/"+basename(file.path));
        check(response.ok()&&hash(await response.body())===file.sha256,"served-client-drift");
      }
      const html=build.files.find(f=>f.path===["client","local-chat.html"].join("\\"));
      check(hash(await(await page.request.get(origin+"/chat")).body())===html.sha256,"served-html-drift");
      r.passed=true;
    }catch(error){
      r.failure=error instanceof Error?error.message:"runtime-check-failed";
      await page.screenshot({path:resolve(dir,`${port}-failure.png`),fullPage:true});throw error;
    }finally{
      await save("report.json",report);
      try{r.cleanup=await owned.close();r.closed=r.cleanup.closed;}finally{await context.close();await save("report.json",report);}
    }
  }
  check(JSON.stringify(report.runtimes[0].messages)===JSON.stringify(report.runtimes[1].messages),"demo-changed");
  check(report.runtimes.every(r=>r.closed),"cleanup-incomplete");report.passed=true;
}catch(error){report.failure=error instanceof Error?error.message:"verification-failed";process.exitCode=1;}
finally{await browser.close();await save("report.json",report);console.log(JSON.stringify({passed:report.passed,buildSha256:report.buildSha256,failure:report.failure,evidence:dir}));}
