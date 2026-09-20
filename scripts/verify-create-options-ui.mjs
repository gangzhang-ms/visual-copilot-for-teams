import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const google=process.argv.includes("--google-create"),fixed=process.argv.includes("--commons-fixed"),commons=fixed||process.argv.includes("--commons-create"),web=google||commons||process.argv.includes("--web-create"),resilient=web||process.argv.includes("--resilient-create"),mixed=resilient||process.argv.includes("--mixed-create"),separated=mixed||process.argv.includes("--express-scope");
if(process.argv.slice(2).some(arg=>!["--express-scope","--mixed-create","--resilient-create","--web-create","--commons-create","--commons-fixed","--google-create"].includes(arg)))throw new Error("Unknown verification option");
const origin=`http://127.0.0.1:${google?4352:fixed?4351:commons?4350:web?4349:resilient?4348:mixed?4347:separated?4346:4345}`,directory=resolve(".local","visual-context",google?"google-create-validation":fixed?"commons-fixed-validation":commons?"commons-create-validation":web?"web-create-validation":resilient?"resilient-create-validation":mixed?"mixed-create-validation":separated?"express-scope-validation":"create-options-validation");
const create3=mixed?"Create 3 options":"Generate 3 options",create1=mixed?"Create 1 option":"Generate 1 option";
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin),report={origin,paidRoutes:0,sourceLoads:0,externalRequests:0,closed:false,passed:false};
await page.route("**/*",async route=>{
  const url=new URL(route.request().url());
  if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalRequests++;return route.abort();}
  if(["/local/process","/local/generation/process","/local/generation/batch/process"].includes(url.pathname)){report.paidRoutes++;return route.abort();}
  if(["/local/catalog/load","/local/generation/batch/review","/local/generation/batch/source/retry"].includes(url.pathname)){report.sourceLoads++;return route.abort();}
  return route.continue();
});
try{
  await owned.start();report.health=await (await page.request.get(origin+"/healthz")).json();
  expect(report.health.imageGenerationScope).toBe("configuration-only");
  await page.goto(origin+"/chat");
  await expect(page.locator("html")).toHaveAttribute("lang","en");
  if(separated){
    const panel=page.locator(".local-copilot");
    for(const language of ["en","zh-CN"]){
      await page.getByLabel("Language / 语言").selectOption(language);
      for(const width of [320,556]){
        await page.setViewportSize({width,height:950});
        if(!await panel.isVisible())await page.getByRole("button",{name:language==="en"?"Open AI panel":"打开 AI 面板",exact:true}).click();
        await expect(panel.getByRole("heading",{name:language==="en"?"Explain a picture or emoji":"解释图片或 emoji",exact:true})).toBeVisible();
        await expect(panel.locator(".studio-ai-card,.local-generation,.speaker-profile")).toHaveCount(0);
        await expect(page.locator(".local-tabs").getByRole("button",{name:language==="en"?"Explain":"解释含义",exact:true})).toHaveAttribute("aria-pressed","true");
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
        await page.screenshot({path:resolve(directory,`explain-${language}-${width}.png`)});
      }
    }
    await page.setViewportSize({width:1440,height:950});
    await page.getByLabel("Language / 语言").selectOption("en");
  }
  await page.getByRole("button",{name:"Start a demo conversation",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(5);
  await expect(page.getByTestId("chat-message").first()).toContainText("one portal for deployments, alerts, and billing");
  await page.locator(".local-composer").getByRole("button",{name:"Help me express",exact:true}).click();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  const description=page.getByLabel("What would you like to express?",{exact:true});
  await description.fill("A fictional team deciding between two paths");
  if(google){
    await expect(page.locator(".local-generation")).toContainText("Google Images via SerpApi");
    await expect(page.getByText("Configure Google Images via SerpApi",{exact:true})).toBeVisible();
    expect(report.health.webImageSearch).toEqual({configured:false,provider:"Google Images via SerpApi",keyRequired:true,scope:"configuration-only"});
  }else if(commons){
    await expect(page.locator(".local-generation")).toContainText("Wikimedia search terms (shared library; no key");
    await expect(page.locator(".web-search-setup")).toHaveCount(0);
    expect(report.health.webImageSearch).toEqual({configured:true,provider:"Wikimedia Commons",keyRequired:false,scope:"configuration-only"});
  }else if(web){
    await expect(page.locator(".local-generation")).toContainText("Brave search terms (when configured");
    await expect(page.getByText("Configure web image search",{exact:true})).toBeVisible();
    expect(report.health.webImageSearch).toMatchObject({configured:false,scope:"configuration-only"});
  }
  await expect(page.getByRole("button",{name:create3,exact:true})).toBeEnabled();
  if(resilient){
    await expect(page.locator(".creation-summary")).toContainText("1 existing image with editable caption + 2 AI-generated options");
    await expect(page.locator(".creation-advanced").getByText(/2 sequential AI image requests/)).not.toBeVisible();
  }else if(mixed)await expect(page.locator(".local-generation")).toContainText("2 sequential AI image requests");
  await expect(page.locator(".creation-advanced")).not.toHaveAttribute("open","");
  await expect(page.locator(".local-generation")).toContainText(google?"No source pixels condition generation":"not reference-image pixels");
  await page.screenshot({path:resolve(directory,"create-options-desktop.png")});
  await page.locator(".creation-advanced > summary").click();
  await expect(page.getByLabel("Number of options",{exact:true})).toHaveValue("3");
  await page.getByLabel("Number of options",{exact:true}).selectOption("1");
  if(!web)await page.getByRole("checkbox",{name:"Public meme inspiration (text only)",exact:true}).uncheck();
  await page.getByRole("radio",{name:"Find an existing image",exact:true}).check();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await expect(page.getByRole("button",{name:create1,exact:true})).toBeEnabled();
  await expect(description).toHaveValue("A fictional team deciding between two paths");
  await page.locator(".creation-advanced > summary").click();
  if(!web)await expect(page.getByRole("checkbox",{name:"Public meme inspiration (text only)",exact:true})).not.toBeChecked();
  await page.getByLabel("Number of options",{exact:true}).selectOption("3");
  await page.getByRole("checkbox",{name:commons?"Include Wikimedia image search":web?"Include web image search":mixed?"Include an existing public image + caption":"Public meme inspiration (text only)",exact:true}).check();
  await page.locator(".creation-advanced > summary").click();
  await page.setViewportSize({width:320,height:950});
  await page.getByRole("button",{name:create3,exact:true}).scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:resolve(directory,"create-options-mobile.png")});
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await expect(page.getByRole("button",{name:mixed?"创建 3 个方案":"生成 3 个方案",exact:true})).toBeEnabled();
  await expect(page.getByLabel("你想表达什么？",{exact:true})).toHaveValue("A fictional team deciding between two paths");
  expect(report.paidRoutes+report.sourceLoads+report.externalRequests).toBe(0);
  report.passed=true;
}finally{
  try{report.closed=(await owned.close()).closed;expect(report.closed).toBe(true);}
  finally{await context.close();await browser.close();}
  report.recordedAt=new Date().toISOString();
  await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
