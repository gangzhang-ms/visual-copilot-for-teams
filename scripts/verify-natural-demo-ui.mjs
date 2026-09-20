import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";
if(process.argv.length>3||process.argv[2]!==undefined&&!["--visual-target","--clean-explanation"].includes(process.argv[2]))throw new Error("Unsupported verification target");
const visualTarget=process.argv[2]==="--visual-target";
const cleanExplanation=process.argv[2]==="--clean-explanation";
const origin=cleanExplanation?"http://127.0.0.1:4333":visualTarget?"http://127.0.0.1:4332":"http://127.0.0.1:4330",directory=resolve(".local","visual-context",cleanExplanation?"clean-explanation-validation":visualTarget?"visual-target-validation":"natural-demo-validation");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"});
const report={origin,recordedAt:"",mocked:false,modelRoutes:0,imageRoutes:0,sourceLoads:0,externalBrowserRequests:0,rooms:[],passed:false};
try{
  for(const language of ["en","zh-CN"]){
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
    const owned=ownedBrowserSession(page,origin),entry={language,chatStatus:0,demoStatus:0,providerRequests:0,mediaInformation:false,ownRoomClosed:false};
    report.rooms.push(entry);
    const t=(en,zh)=>language==="en"?en:zh;
    page.on("request",r=>{
      const url=new URL(r.url());
      if(url.pathname==="/local/process")report.modelRoutes++;
      if(url.pathname==="/local/generation/process")report.imageRoutes++;
      if(url.pathname==="/local/catalog/load")report.sourceLoads++;
      if(["http:","https:"].includes(url.protocol)&&url.origin!==origin)report.externalBrowserRequests++;
    });
    try{
      await owned.start();
      const health=await (await page.request.get(origin+"/healthz")).json();
      expect(health).toMatchObject({ready:true,model:true,imageGeneration:"ready",sessionClose:true,sessionAdmission:"no-count-quota"});
      entry.chatStatus=(await page.goto(origin+"/chat")).status();expect(entry.chatStatus).toBe(200);
      await page.getByLabel("Language / 语言").selectOption(language);
      await expect(page.getByLabel(t("Message","消息内容"),{exact:true})).toBeEnabled();
      const loaded=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/demo");
      await page.getByRole("button",{name:t("Start a demo conversation","从演示对话开始"),exact:true}).click();
      const response=await loaded;entry.demoStatus=response.status();expect(entry.demoStatus).toBe(200);
      const room=await response.json();entry.providerRequests=room.providerRequests;expect(entry.providerRequests).toBe(0);
      entry.messages=room.messages.map(m=>m.text);
      expect(entry.messages).toEqual(language==="en"?[
        "The login fix is in. Try again?","Works now! Thanks for sticking with me.","Same here. Finally calling it a day.","No more changes tonight 😂","Deal. Tomorrow it is."
      ]:["登录修好了，再试试？","这次可以了！陪我查了这么久，谢啦。","我这边也好了，终于能下班了。","今晚别再改了😂","同意，明天再说。"]);
      expect(room.messages.map(m=>m.demoMedia??null)).toEqual([null,"illustration","local-motion",null,null]);
      await expect(page.getByTestId("chat-message")).toHaveCount(5);
      expect(await page.locator(".local-messages").innerText()).not.toMatch(/illustration|pan\/zoom|预备|插画|未新增|not native/iu);
      for(const index of [1,2]){
        const message=page.getByTestId("chat-message").nth(index);
        await expect.poll(()=>message.locator("img.local-upload").evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
        await expect(message.getByRole("button",{name:t("Explain","解释一下"),exact:true})).toBeEnabled();
      }
      await expect(page.getByTestId("chat-message").nth(3).getByRole("button",{name:t("Explain","解释一下"),exact:true})).toBeEnabled();
      await expect(page.getByTestId("chat-message").first().getByRole("button",{name:t("Explain","解释一下"),exact:true})).toHaveCount(0);
      await page.getByTestId("chat-message").nth(1).scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(directory,`${language}-desktop.png`)});
      for(const index of [1,2]){
        const trigger=page.getByTestId("chat-message").nth(index).getByRole("button",{name:t("Message actions","消息操作"),exact:true});
        await trigger.click();await page.getByRole("menuitem",{name:t("Media information","素材信息"),exact:true}).click();
        await expect(page.getByRole("dialog",{name:t("Media information","素材信息"),exact:true})).toContainText(index===1?t("Prepared original gardener illustration","预备原创园丁插画"):t("local pan/zoom GIF, not native video","本地平移缩放 GIF，非原生视频"));
        await page.keyboard.press("Escape");await expect(trigger).toBeFocused();
      }
      entry.mediaInformation=true;
      await page.setViewportSize({width:320,height:900});
      if(await page.getByRole("button",{name:t("Hide AI panel","收起 AI 面板"),exact:true}).isVisible())await page.getByRole("button",{name:t("Hide AI panel","收起 AI 面板"),exact:true}).click();
      await page.getByTestId("chat-message").nth(2).scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:resolve(directory,`${language}-mobile.png`)});
    }finally{
      try{entry.ownRoomClosed=(await owned.close()).closed;expect(entry.ownRoomClosed).toBe(true);}
      finally{await context.close();}
    }
  }
  expect(report.modelRoutes+report.imageRoutes+report.sourceLoads+report.externalBrowserRequests).toBe(0);
  report.passed=true;
}finally{
  await browser.close();report.recordedAt=new Date().toISOString();
  await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
