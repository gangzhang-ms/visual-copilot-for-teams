import {chromium,expect} from "@playwright/test";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";

const brief=process.argv.includes("--brief-explain");
const source=process.argv.includes("--source-background");
const origin=source?"http://127.0.0.1:4344":brief?"http://127.0.0.1:4343":"http://127.0.0.1:4342",
  directory=resolve(".local","visual-context",source?"source-background-validation":brief?"brief-background-validation":"pop-culture-demo-validation");
await mkdir(directory,{recursive:true});
const manifest=JSON.parse(await readFile(resolve("assets","chat-demo","reference-manifest.json"),"utf8"));
const browser=await chromium.launch({channel:"msedge"});
const report={origin,paidRoutes:0,sourceLoads:0,externalRequests:0,rooms:[],passed:false};
try{
  for(const language of ["en","zh-CN"]){
    const t=(en,zh)=>language==="en"?en:zh;
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
    const owned=ownedBrowserSession(page,origin),room={language,closed:false};
    report.rooms.push(room);
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalRequests++;return route.abort();}
      if(["/local/process","/local/generation/process"].includes(url.pathname)){report.paidRoutes++;return route.abort();}
      if(url.pathname==="/local/catalog/load"){report.sourceLoads++;return route.abort();}
      return route.continue();
    });
    try{
      await owned.start();await page.goto(origin+"/chat");
      await expect(page.locator("html")).toHaveAttribute("lang","en");
      if(language!=="en")await page.getByLabel("Language / 语言").selectOption(language);
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/demo");
      await page.getByRole("button",{name:t("Start a demo conversation","从演示对话开始"),exact:true}).click();
      const result=await response;expect(result.status()).toBe(200);const state=await result.json();
      await expect(page.getByTestId("chat-message")).toHaveCount(5);
      await expect(page.getByTestId("chat-message").first()).toContainText(t("one portal","同一个门户"));
      const image=page.getByAltText(t("Shared image","分享的图片"),{exact:true});
      await expect(image).toBeVisible();
      expect(await image.evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight,complete:img.complete})))
        .toEqual({width:380,height:301,complete:true});
      room.referenceHash=createHash("sha256").update(Buffer.from(state.messages[1].attachment.dataUrl.split(",")[1],"base64")).digest("hex");
      expect(room.referenceHash).toBe(manifest.assets[0].sha256);
      expect(state.messages[1].demoMedia).toBe("user-reference");
      expect(state.messages[2].attachment.category).toBe("gif");
      expect(state.messages[3].text).toContain("🙂");
      expect(await page.locator(".local-messages").innerText()).not.toMatch(/rights unverified|底层素材权利|Gandalf|sarcasm/iu);
      for(const index of [1,2,3])await expect(page.getByTestId("chat-message").nth(index)
        .getByRole("button",{name:t("Explain","解释一下"),exact:true})).toBeEnabled();
      const trigger=page.getByTestId("chat-message").nth(1).getByRole("button",{name:t("Message actions","消息操作"),exact:true});
      await trigger.click();await page.getByRole("menuitem",{name:t("Media information","素材信息"),exact:true}).click();
      await expect(page.getByRole("dialog")).toContainText(t("underlying rights unverified","底层素材权利未经核实"));
      await page.keyboard.press("Escape");
      room.reviews=await page.evaluate(async language=>{
        const session=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
        const headers={"Content-Type":"application/json","X-Local-CSRF":session.csrf};
        const state=await (await fetch("/local/state",{method:"POST",headers,body:"{}"})).json();
        const input={version:0,intent:"",context:state.messages.map(m=>({label:m.id,text:`${m.speaker}: ${m.text}`,timestamp:"",included:true})),
          preferences:{source:"requester-reported",confirmed:true,outputLanguage:language,familiarity:"",formality:"unknown",relationship:"",humor:"",avoid:""}};
        const reviews=[];let revision=state.revision;
        for(const index of [1,2,3]){
          const response=await fetch("/local/review",{method:"POST",headers,body:JSON.stringify({
            revision,command:"explainVisual",selectedId:state.messages[index].id,input})});
          if(!response.ok)throw new Error("Local non-dispatch review failed: "+(await response.json()).code);
          const review=await response.json();revision=review.revision;
          reviews.push({status:response.status,contexts:review.input.context.length,frames:review.media.samples.length,
            target:review.input.explanationTarget,language:review.input.preferences.outputLanguage});
        }
        const repeated=await fetch("/local/demo",{method:"POST",headers,body:JSON.stringify({revision,language})});
        if(repeated.ok)throw new Error("Demo overwrote an occupied room");
        const after=await (await fetch("/local/state",{method:"POST",headers,body:"{}"})).json();
        if(JSON.stringify(after.messages)!==JSON.stringify(state.messages))throw new Error("Existing messages changed");
        return reviews;
      },language);
      expect(room.reviews.map(r=>r.frames)).toEqual([1,2,0]);
      expect(room.reviews.every(r=>r.contexts===5&&r.language===language)).toBe(true);
      await image.scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(directory,`${language}-desktop.png`)});
      await page.setViewportSize({width:320,height:950});
      const hide=page.getByRole("button",{name:t("Hide AI panel","收起 AI 面板"),exact:true});
      if(await hide.isVisible())await hide.click();
      await image.scrollIntoViewIfNeeded();
      await image.click({trial:true});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      const box=await image.boundingBox();expect(box.width).toBeGreaterThanOrEqual(200);
      await page.screenshot({path:resolve(directory,`${language}-mobile.png`)});
    }finally{
      try{room.closed=(await owned.close()).closed;expect(room.closed).toBe(true);}
      finally{await context.close();}
    }
  }
  expect(report.paidRoutes+report.sourceLoads+report.externalRequests).toBe(0);
  report.passed=true;
}finally{
  await browser.close();report.recordedAt=new Date().toISOString();
  await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
