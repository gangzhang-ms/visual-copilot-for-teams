import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const origin="http://127.0.0.1:4335",directory=resolve(".local","visual-context","clean-ui-validation");
await mkdir(directory,{recursive:true});
const report={origin,recordedAt:"",paidRoutes:0,sourceLoads:0,externalBrowserRequests:0,rooms:[],passed:false};
const browser=await chromium.launch({channel:"msedge"});
try{
  for(const language of ["en","zh-CN"]){
    const t=(en,zh)=>language==="en"?en:zh;
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),owned=ownedBrowserSession(page,origin);
    const room={language,closed:false};report.rooms.push(room);
    page.on("request",r=>{
      const url=new URL(r.url());
      if(["/local/process","/local/generation/process"].includes(url.pathname))report.paidRoutes++;
      if(url.pathname==="/local/catalog/load")report.sourceLoads++;
      if(["http:","https:"].includes(url.protocol)&&url.origin!==origin)report.externalBrowserRequests++;
    });
    for(const path of ["process","generation/process","catalog/load"])await page.route(`**/local/${path}`,route=>route.abort());
    try{
      await owned.start();
      report.health=await (await page.request.get(origin+"/healthz")).json();
      expect(report.health).toMatchObject({ready:true,model:true,imageGeneration:"ready",sessionClose:true,sessionAdmission:"no-count-quota"});
      room.chatStatus=(await page.goto(origin+"/chat")).status();expect(room.chatStatus).toBe(200);
      await page.getByLabel("Language / 语言").selectOption(language);
      await page.getByRole("button",{name:t("Create image / GIF","创作图片 / GIF"),exact:true}).click();
      await page.getByLabel(t("Creative intent","创作意图"),{exact:true}).fill(t("Thank a fictional colleague","感谢虚构的同事"));
      await page.getByLabel(t("Creative description","创作描述"),{exact:true}).fill(t("An original gardener with a warm smile","一位面带温暖微笑的原创园丁"));
      await page.getByLabel(t("Expression style","表达风格"),{exact:true}).selectOption("playful-doodle");
      const reviewed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/review");
      await page.getByRole("button",{name:t("Confirm creative idea","确认创作内容"),exact:true}).click();
      room.reviewStatus=(await reviewed).status();expect(room.reviewStatus).toBe(200);
      const confirmation=page.getByRole("region",{name:t("Creation confirmation","创作确认")});
      await expect(confirmation).toContainText(t("Thank a fictional colleague","感谢虚构的同事"));
      await expect(confirmation).toContainText(t("Playful doodle","松弛涂鸦"));
      await expect(page.getByRole("button",{name:t("Generate image","生成图片"),exact:true})).toBeEnabled();
      await expect(page.locator("pre")).toHaveCount(0);
      expect(await page.locator("body").innerText()).not.toMatch(/aoai-visual-context|your-image-deployment|gpt-image|api-version|personal-image-ongoing|max_tokens|1024|512px|bytes|SHA-256|Model requests|模型请求|内容摘要|目的地（|全部文字与选项/iu);
      await confirmation.scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(directory,`${language}-live-desktop.png`)});
      await page.setViewportSize({width:320,height:900});await confirmation.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:resolve(directory,`${language}-live-mobile.png`)});
      expect(report.paidRoutes+report.sourceLoads+report.externalBrowserRequests).toBe(0);
    }finally{try{room.closed=(await owned.close()).closed;expect(room.closed).toBe(true);}finally{await context.close();}}
  }
  report.passed=true;
}finally{
  await browser.close();report.recordedAt=new Date().toISOString();
  await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
