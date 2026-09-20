import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const port=Number(process.env.LOCAL_CHAT_PORT??4319);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("Invalid loopback port");
const origin=`http://127.0.0.1:${port}`;
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext(),page=await context.newPage();
let paidRoutes=0,report;
const owned=ownedBrowserSession(page,origin);
page.on("request",request=>{if(["/local/process","/local/generation/process"].includes(new URL(request.url()).pathname))paidRoutes++;});
try{
  await owned.start();
  await page.goto(origin+"/chat");
  await page.getByLabel("Language / 语言").selectOption("en");
  await page.getByRole("button",{name:"Create",exact:true}).click();
  await expect(page.getByTestId("generation-readiness")).toContainText("Authorized finite run");
  await expect(page.getByTestId("generation-readiness")).toContainText("three ordinary attempts total");
  await page.getByLabel("Creative intent",{exact:true}).fill("An original geometric greeting for a fictional puzzle club.");
  await page.getByRole("button",{name:"Prepare exact creative brief",exact:true}).click();
  await expect(page.getByRole("region",{name:"Exact creative request"})).toContainText("your-image-deployment");
  const consent=page.getByRole("checkbox",{name:/explicitly consent to this exact paid/});
  const generate=page.getByRole("button",{name:"Generate once",exact:true});
  await expect(generate).toBeDisabled();await consent.check();await expect(generate).toBeEnabled();
  // The real paid button is intentionally never clicked.
  await page.getByLabel("Creative description",{exact:true}).fill("A circle and a square, no text.");
  await expect(page.getByRole("region",{name:"Exact creative request"})).toHaveCount(0);
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await page.getByRole("button",{name:"准备确切创作简报",exact:true}).click();
  await expect(page.getByRole("region",{name:"确切创作请求"})).toBeVisible();
  await expect(page.getByTestId("generation-readiness")).toContainText("已授权的有限运行");
  await page.setViewportSize({width:320,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.getByRole("button",{name:"生成一次",exact:true})).toBeDisabled();
  const final=await page.evaluate(async()=>{
    const session=await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>r.json());
    const response=await fetch("/local/reset",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"});
    if(!response.ok)throw new Error("Own smoke-room cleanup failed");
    const room=await response.json();return {generation:room.generation,messages:room.messages.length};
  });
  expect(paidRoutes).toBe(0);expect(final.messages).toBe(0);expect(final.generation.ready).toBe(true);
  report={recordedAt:new Date().toISOString(),origin,allPassed:true,paidRoutes,interception:false,fakeTransport:false,
    enabledOnlyAfterConsent:true,editRevokesReview:true,bilingual:true,width320:true,ownRoomCleared:true,generation:final.generation};
}finally{
  try{const state=await owned.close();if(report)report.ownRoomClosed=state.closed;}
  catch(error){if(report){report.allPassed=false;report.cleanupFailed=true;}throw error;}
  finally{
    await context.close();await browser.close();
    if(report){await writeFile(resolve(".local","visual-context","image-ui-smoke.json"),JSON.stringify(report,null,2)+"\n");process.stdout.write(JSON.stringify(report,null,2)+"\n");}
  }
}
