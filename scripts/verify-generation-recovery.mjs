import {chromium,expect} from "@playwright/test";
import {mkdir,open,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";

const phase=process.argv[2];
if(!["baseline","confirmation"].includes(phase)||process.argv.length!==3)throw new Error("Choose baseline or confirmation; each permits one original synthetic image request once.");
const origin=`http://127.0.0.1:${phase==="baseline"?4339:4340}`,directory=resolve(".local","visual-context","generation-recovery-validation");
await mkdir(directory,{recursive:true});
const marker=await open(resolve(directory,`${phase}-attempt.json`),"wx");
await marker.writeFile(JSON.stringify({phase,startedAt:new Date().toISOString(),maximumCalls:1}));await marker.close();
const report={phase,origin,startedAt:new Date().toISOString(),providerRoutes:0,otherPaidRoutes:0,closed:false,passed:false};
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin);
try{
  await owned.start();await page.goto(origin+"/chat");
  await page.route("**/local/generation/process",async route=>{report.providerRoutes++;if(report.providerRoutes>1)await route.abort();else await route.continue();});
  for(const path of ["process","catalog/load"])await page.route(`**/local/${path}`,async route=>{report.otherPaidRoutes++;await route.abort();});
  await page.getByLabel("Language / 语言").selectOption("en");
  await page.locator(".local-composer").getByRole("button",{name:"Help me express",exact:true}).click();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await page.getByLabel("What would you like to express?",{exact:true}).fill("An original fictional detective in a simple blue coat, smiling gratefully and tipping a hat to two teammates. Original drawing, plain background, no text.");
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/generation/process",{timeout:180_000});
  await page.getByRole("button",{name:"Generate image",exact:true}).click();
  const result=await response,value=await result.json();
  report.localHttpStatus=result.status();report.operationStatus=value.status;
  if(/^generation-[a-z-]{1,70}$/.test(value.code??""))report.code=value.code;
  if(value.failure)report.failure=value.failure;
  if(value.status==="ready"){
    await expect(page.getByText("Output ready for your inspection",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Preview generated insertion",exact:true}).click();
    await page.getByRole("button",{name:"Insert generated visual locally",exact:true}).click();
    await expect(page.getByTestId("chat-message")).toHaveCount(1);
    const image=page.getByTestId("chat-message").locator("img").first();
    await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    report.image=await image.evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));
    report.passed=true;
  }
}catch{report.checkError="synthetic-browser-check-failed";}
finally{
  try{const cleanup=await owned.close();report.closed=cleanup.closed;report.readiness=cleanup.generation?{mode:cleanup.generation.mode,ready:cleanup.generation.ready,reason:cleanup.generation.reason}:undefined;}
  finally{await context.close();await browser.close();}
  report.finishedAt=new Date().toISOString();
  await writeFile(resolve(directory,`${phase}-report.json`),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));if(!report.passed||!report.closed||report.otherPaidRoutes)process.exitCode=1;
}
