import {test,expect} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import type {Explanation} from "../../src/shared/types";
const root=process.env.VISUAL_BUILD_ROOT??"dist";
const built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
for(const language of ["en","zh-CN"] as const)test(`${language}: compact visual/custom/Unicode defaults preserve complete statements and all details`,async({browser})=>{
  test.setTimeout(90_000);
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const evidence:Record<string,unknown>[]=[],measurements:{version:string;target:number;height:number;characters:number;blocks:number}[]=[];
  const dir=resolve(".local","visual-context","compact-explain-offline");await mkdir(dir,{recursive:true});
  const baselineAvailable=existsSync(resolve("dist-chat-visual-inline","client","assets"));
  if(!baselineAvailable)test.info().annotations.push({type:"scope",description:"Historical 4369 artifacts are not distributed. Current-result and no-second-call assertions run; before/after measurements are unavailable."});
  const versions=baselineAvailable?[["4369","dist-chat-visual-inline"],["4370",root]]:[["4370",root]];
  for(const [version,clientRoot] of versions){
    let calls=0,external=0;
    localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
    const forbidden=async()=>{external++;throw new Error("External action forbidden");};
    const app=await createLocalChatServer("OFFLINE-COMPACT-FIXTURE",{clientRoot:resolve(clientRoot,"client"),interaction:"direct-personal",
      emojiExpressions:true,contextualCreation:true,creationChoices:true,cooldownMs:0,catalogSource:"original-demo",
      memeTransport:forbidden,webSearchTransport:forbidden,generation:{transport:forbidden},
      transport:async(_url,init)=>{
        calls++;const body=JSON.parse(String(init?.body)),input=JSON.parse(body.messages[1].content[0].text);
        const known=input.target.kind==="visual"&&!input.target.source;
        return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          background:known?{source:t("The Lord of the Rings (fixture)","《指环王》（测试夹具）"),
            context:t("The quotation refers to the One Ring and its power over the other rings. That fictional source background is distinct from any claim about the proposed workplace portal.","这句台词涉及至尊魔戒及其对其他戒指的支配。这是虚构作品的背景，并不代表对尚在提议中的工作门户作出事实判断。"),frames:input.frames.map((f:{id:string})=>f.id)}:{source:null,context:null,frames:[]},
          observations:[{text:t("The selected content is visible in this owned demonstration, with features that can support more than one interpretation.","所选内容来自这段自有演示，可见特征可能支持不止一种解读。"),frames:input.frames.map((f:{id:string})=>f.id)}],
          commonUsage:[t("Such reactions may soften a response, acknowledge a request, or express mixed feelings depending on the group and platform.","这类回应可能用于缓和语气、回应请求或表达复杂感受，取决于群体和平台。")],
          contextualInterpretations:[
            {text:t("This may be a playful response to the proposed plan. It does not prove agreement, sarcasm, or the sender's intention.","这可能是在轻松地回应所提议的计划。但这不能证明赞同、讽刺或发送者的真实意图。"),context:input.context.map((c:{label:string})=>c.label)},
            {text:t("Another reading is cautious acknowledgement; the surrounding exchange alone cannot settle the tone.","另一种解读是谨慎的回应；仅凭周围对话不能确定语气。"),context:input.context.map((c:{label:string})=>c.label)}],
          uncertainties:[t("Tone, individual habits, platform rendering and missing earlier context can change the interpretation.","语气、个人习惯、平台显示和缺失的更早上下文均可能改变解读。"),t("Do not infer anyone's culture or intent from a name or a symbol.","不要从姓名或符号推断任何人的文化背景或意图。")],
          safeResponseGuidance:[t("Ask neutrally whether they want to proceed or discuss an alternative.","中立地询问对方是想继续还是讨论替代方案。")]
        })}}]});
      }});
    const origin=await app.start(0),context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
    await page.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    try{
      await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
      await page.getByLabel("Language / 语言").selectOption(language);
      await page.getByRole("button",{name:t("Start demo","开始演示"),exact:true}).click();
      await expect(page.getByTestId("chat-message")).toHaveCount(9);
      for(const [count,target] of [1,3,7].entries()){
        const row=page.getByTestId("chat-message").nth(target);
        await row.locator(".emoji-enlargement > summary").click();expect(calls).toBe(count);
        const inline=row.locator(".inline-emoji-explanation"),wait=page.waitForResponse(r=>r.url().endsWith("/local/process"));
        await inline.getByRole("button",{name:t("Explain with AI","AI解释"),exact:true}).click();
        const response=await wait;expect(response.status()).toBe(200);
        const value=(await response.json()).result.explanation as Explanation;
        const result=inline.locator(".inline-emoji-result"),details=inline.locator(".inline-explanation-details"),sidebar=page.locator(".explanation-panel");
        await expect(result).toBeVisible();await expect(details).toBeHidden();
        const metric=await result.evaluate(el=>({height:el.getBoundingClientRect().height,characters:(el as HTMLElement).innerText.length,blocks:el.querySelectorAll("p").length}));
        measurements.push({version,target,...metric});
        const sidebarText=await sidebar.innerText();
        if(version==="4370"){
          await expect(result.locator(".explanation-brief")).toHaveText(t("Possible meaning here: ","此处可能含义：")+value.contextualInterpretations[0].text);
          await expect(result.locator("p")).toHaveCount(target===1?2:1);
          await expect(sidebar.locator(".explanation-brief")).toHaveText(t("Possible meaning here: ","此处可能含义：")+value.contextualInterpretations[0].text);
          for(const extra of [...value.commonUsage,...value.uncertainties,...value.safeResponseGuidance,value.observations[0].text,value.contextualInterpretations[1].text]){
            expect(await result.innerText()).not.toContain(extra);expect(sidebarText).not.toContain(extra);
          }
          if(target===1){
            await expect(result.locator(".explanation-source")).toContainText(value.background.source!);
            expect(await result.innerText()).not.toContain(value.background.context!);
          }else await expect(result.locator(".explanation-source")).toHaveCount(0);
          expect(await result.locator(".explanation-brief").evaluate(el=>Math.abs(el.scrollHeight-el.getBoundingClientRect().height)<2)).toBe(true);
          const toggle=inline.getByRole("button",{name:t("Details","详情"),exact:true});
          await expect(toggle).toHaveAttribute("aria-expanded","false");await toggle.focus();await page.keyboard.press("Enter");
          await expect(details).toBeVisible();await expect(toggle).toBeFocused();await expect(toggle).toHaveAttribute("aria-expanded","true");
          for(const full of [...value.observations.map(o=>o.text),...value.commonUsage,...value.contextualInterpretations.map(i=>i.text),...value.uncertainties,...value.safeResponseGuidance,
            ...value.observations.flatMap(o=>o.frames),...value.contextualInterpretations.flatMap(i=>i.context)]){
            await expect(details).toContainText(full);
          }
          if(target!==7)await expect(details.locator(".explanation-background")).toBeVisible();
          if(target===1)await expect(details).toContainText(value.background.context!);
          await toggle.focus();await page.keyboard.press("Space");await expect(details).toBeHidden();
          await toggle.click();await toggle.click();expect(calls).toBe(count+1);
          await sidebar.locator(".explanation-details > summary").focus();await page.keyboard.press("Enter");
          for(const full of [...value.commonUsage,...value.uncertainties,...value.safeResponseGuidance,...value.contextualInterpretations.map(i=>i.text)])
            await expect(sidebar.locator(".explanation-details")).toContainText(full);
          await page.keyboard.press("Space");await expect(sidebar.locator(".explanation-details")).not.toHaveAttribute("open");
        }
        await page.setViewportSize({width:390,height:1000});
        await page.getByRole("button",{name:t("Hide AI panel","收起 AI 面板"),exact:true}).click();
        const box=await result.boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(390);
        const narrow=await result.evaluate(el=>({height:el.getBoundingClientRect().height,characters:(el as HTMLElement).innerText.length}));
        await row.screenshot({path:resolve(dir,`${version}-${language}-${target}-default.png`)});
        if(version==="4370"){
          await inline.getByRole("button",{name:t("Details","详情"),exact:true}).click();
          await row.screenshot({path:resolve(dir,`${version}-${language}-${target}-details.png`)});
          expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
          await inline.getByRole("button",{name:t("Details","详情"),exact:true}).click();
        }
        await row.getByRole("button",{name:t("Message actions","消息操作"),exact:true}).click();await page.keyboard.press("Escape");
        await page.setViewportSize({width:1440,height:1100});await page.getByRole("button",{name:t("Open AI panel","打开 AI 面板"),exact:true}).click();
        expect(calls).toBe(count+1);evidence.push({version,target,language,fixtureOnly:true,paidCalls:0,result:value,metric,narrow,sidebarText});
      }
      expect(external).toBe(0);
    }finally{
      await writeFile(resolve(dir,`${language}-evidence.json`),JSON.stringify({fixtureOnly:true,paidCalls:0,evidence,measurements},null,2));
      await context.close();await app.close();
    }
  }
  for(const target of baselineAvailable?[1,3,7]:[]){
    const before=measurements.find(m=>m.version==="4369"&&m.target===target)!,after=measurements.find(m=>m.version==="4370"&&m.target===target)!;
    expect(after.blocks).toBeLessThan(before.blocks);expect(after.characters).toBeLessThan(before.characters);expect(after.height).toBeLessThan(before.height);
  }
});
