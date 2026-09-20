import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const recovery=process.argv.includes("--generation-recovery"),simple=recovery||process.argv.includes("--simple-create"),oneclick=simple||process.argv.includes("--oneclick-create"),instant=oneclick||process.argv.includes("--instant-create");
const origin=recovery?"http://127.0.0.1:4340":simple?"http://127.0.0.1:4339":oneclick?"http://127.0.0.1:4338":instant?"http://127.0.0.1:4337":"http://127.0.0.1:4336",directory=resolve(".local","visual-context",recovery?"generation-recovery-ui":simple?"simple-create-validation":oneclick?"oneclick-create-validation":instant?"instant-create-validation":"unified-express-validation");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"}),report={origin,recordedAt:"",paidRoutes:0,sourceLoads:0,externalBrowserRequests:0,rooms:[],passed:false};
try{
  for(const language of ["en","zh-CN"]){
    const t=(en,zh)=>language==="en"?en:zh,context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
    const owned=ownedBrowserSession(page,origin),room={language,closed:false};report.rooms.push(room);
    page.on("request",r=>{
      const url=new URL(r.url());
      if(["/local/process","/local/generation/process"].includes(url.pathname))report.paidRoutes++;
      if(url.pathname==="/local/catalog/load")report.sourceLoads++;
      if(["http:","https:"].includes(url.protocol)&&url.origin!==origin)report.externalBrowserRequests++;
    });
    for(const path of ["process","generation/process","catalog/load"])await page.route(`**/local/${path}`,r=>r.abort());
    try{
      await owned.start();report.health=await (await page.request.get(origin+"/healthz")).json();
      expect(report.health).toMatchObject({ready:true,model:true,imageGeneration:"ready",sessionAdmission:"no-count-quota"});
      room.chatStatus=(await page.goto(origin+"/chat")).status();expect(room.chatStatus).toBe(200);
      await page.getByLabel("Language / 语言").selectOption(language);
      await page.getByRole("button",{name:t("Start a demo conversation","从演示对话开始"),exact:true}).click();
      await expect(page.getByTestId("chat-message")).toHaveCount(5);
      await expect(page.locator(".local-tabs button")).toHaveText([t("Explain","解释含义"),t("Express","帮我表达")]);
      await expect(page.locator(".local-composer .studio-composer-ai")).toHaveCount(1);
      await page.locator(".local-composer").getByRole("button",{name:t("Help me express","帮我表达"),exact:true}).click();
      const intent=page.getByLabel(t("What would you like to express?","你想表达什么？"),{exact:true});
      const text=simple?t("Sherlock Holmes looking pleased after solving a problem","福尔摩斯发现问题后的得意表情，用来庆祝排查成功"):t("Thank a fictional colleague for patiently helping","谢谢虚构的同事耐心帮忙");
      await intent.fill(text);
      const existing=page.getByRole("radio",{name:t("Find an existing image","推荐现成图"),exact:true}),create=page.getByRole("radio",{name:t("Create a new image","生成新图"),exact:true});
      await expect(existing).toBeChecked();
      await expect(page.getByRole("combobox",{name:t("Expression source","表达素材来源")})).toHaveValue("internet");
      await existing.focus();await page.keyboard.press("ArrowRight");await expect(create).toBeChecked();
      if(!simple)await page.getByLabel(t("Creative description","创作描述"),{exact:true}).fill(t("An original thoughtful owl","一只若有所思的原创猫头鹰"));
      await existing.check();await expect(intent).toHaveValue(text);
      await create.check();await expect(intent).toHaveValue(text);
      if(instant){
        await expect(page.getByTestId("generation-readiness")).toContainText(t("Ready to create","可以开始创作"));
        await expect(page.getByTestId("generation-readiness")).not.toContainText(t("Please wait","请稍等"));
      }
      await expect(page.locator(".speaker-profile")).toHaveCount(1);
      if(simple){
        await expect(page.locator(".local-copilot-content").getByRole("textbox")).toHaveCount(1);
        await expect(page.locator(".creation-advanced")).not.toHaveAttribute("open","");
        await expect(page.getByLabel(t("Expression style","表达风格"),{exact:true})).not.toBeVisible();
        await expect(page.getByLabel(t("Expression style","表达风格"),{exact:true})).toHaveValue("auto");
        await expect(page.getByLabel(t("Expression intensity","表达强度"),{exact:true})).toHaveValue("auto");
      }
      if(oneclick){
        await expect(page.getByRole("button",{name:t("Confirm creative idea","确认创作内容"),exact:true})).toHaveCount(0);
        await expect(page.getByRole("region",{name:t("Creation confirmation","创作确认")})).toHaveCount(0);
        await page.getByLabel(t("Requested output","期望输出"),{exact:true}).selectOption("gif");
        await expect(page.getByRole("button",{name:t("Generate GIF","生成 GIF"),exact:true})).toBeEnabled();
        await page.getByLabel(t("Requested output","期望输出"),{exact:true}).selectOption("image");
      }else{
        const reviewed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/review");
        await page.getByRole("button",{name:t("Confirm creative idea","确认创作内容"),exact:true}).click();
        room.reviewStatus=(await reviewed).status();expect(room.reviewStatus).toBe(200);
        await expect(page.getByRole("region",{name:t("Creation confirmation","创作确认")})).toContainText(text);
      }
      await expect(page.getByRole("button",{name:t("Generate image","生成图片"),exact:true})).toBeEnabled();
      await expect(page.locator("pre")).toHaveCount(0);
      expect(await page.locator("body").innerText()).not.toMatch(/aoai-visual-context|gpt-image|personal-image-ongoing|bytes|SHA-256/iu);
      const capture=oneclick?page.getByRole("button",{name:t("Generate image","生成图片"),exact:true}):page.getByRole("region",{name:t("Your expression","你的表达")});
      await capture.scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(directory,`${language}-live-desktop.png`)});
      await page.setViewportSize({width:320,height:900});
      await capture.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      expect((await create.boundingBox()).width).toBeLessThanOrEqual(24);
      await page.screenshot({path:resolve(directory,`${language}-live-mobile.png`)});
      expect(report.paidRoutes+report.sourceLoads+report.externalBrowserRequests).toBe(0);
    }finally{try{room.closed=(await owned.close()).closed;expect(room.closed).toBe(true);}finally{await context.close();}}
  }
  report.passed=true;
}finally{
  await browser.close();report.recordedAt=new Date().toISOString();
  await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
}
