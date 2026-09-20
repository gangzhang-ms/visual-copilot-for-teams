import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";

const origin="http://127.0.0.1:4324",directory=resolve(".local","visual-context","session-no-quota");
const health=await fetch(origin+"/healthz");
if(!health.ok||(await health.json()).sessionAdmission!=="no-count-quota")
  throw new Error("4324 is not running the no-count-quota build. No room was allocated. Start npm run chat:unlimited without restarting older rooms.");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"});
const owners=[];
const report={origin,recordedAt:"",mocked:false,paidRoutes:0,roomsOpened:0,roomsClosed:0,simultaneousRooms:0,sessionHttpStatuses:[],profileSaveStatus:0,profileSaved:false,existingRoomsPreserved:false,passed:false};
try{
  for(let i=0;i<12;i++){
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),owned=ownedBrowserSession(page,origin);
    owners.push({context,page,owned});
    page.on("request",r=>{if(["/local/process","/local/generation/process"].includes(new URL(r.url()).pathname))report.paidRoutes++;});
    page.on("response",r=>{if(new URL(r.url()).pathname==="/local/session")report.sessionHttpStatuses.push(r.status());});
      await owned.start();await page.goto(origin+"/chat");
      await page.getByLabel("Language / 语言").selectOption("en");
      await expect(page.getByLabel("Simulated speaker",{exact:true})).toBeEnabled();
      await expect(page.locator(".local-bootstrap")).toHaveCount(0);report.roomsOpened++;
      await page.getByLabel("Message",{exact:true}).fill(`Synthetic no-quota fixture ${i}`);
      await page.getByLabel("Message",{exact:true}).press("Enter");
      await expect(page.getByTestId("chat-message")).toHaveCount(1);
      if(i===0){
        await page.getByRole("button",{name:"Create image / GIF",exact:true}).click();
        await page.locator(".speaker-profile summary").click();
        await page.getByLabel("Speaker tone",{exact:true}).fill("Calm encouragement for a fictional puzzle team");
        const saved=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/speaker/profile");
        await page.getByRole("button",{name:"Save speaker profile",exact:true}).click();
        report.profileSaveStatus=(await saved).status();expect(report.profileSaveStatus).toBe(200);
        await expect(page.locator(".speaker-profile summary")).toContainText("self-reported");report.profileSaved=true;
        await page.screenshot({path:resolve(directory,"profile-saved-desktop.png")});
        await page.getByLabel("Language / 语言").selectOption("zh-CN");
        await page.setViewportSize({width:320,height:900});
        await expect(page.locator(".speaker-profile summary")).toContainText("自愿填写");
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
        await page.screenshot({path:resolve(directory,"profile-saved-mobile.png")});
      }
  }
  report.simultaneousRooms=owners.length;
  for(const [i,{page}] of owners.entries()){
    await page.reload();
    await page.getByLabel("Language / 语言").selectOption("en");
    await expect(page.getByTestId("chat-message")).toContainText(`Synthetic no-quota fixture ${i}`);
    if(i===0){
      await page.getByRole("button",{name:"Create image / GIF",exact:true}).click();
      await page.locator(".speaker-profile summary").click();
      await expect(page.getByLabel("Speaker tone",{exact:true})).toHaveValue("Calm encouragement for a fictional puzzle team");
    }
  }
  report.existingRoomsPreserved=true;
  expect(report.roomsOpened).toBe(12);expect(report.paidRoutes).toBe(0);
  expect(report.sessionHttpStatuses).toHaveLength(24);expect(report.sessionHttpStatuses.every(s=>s===200)).toBe(true);report.passed=true;
}finally{
  const cleanup=await Promise.allSettled(owners.map(async({context,owned})=>{
    try{const result=await owned.close();if(result.closed)report.roomsClosed++;}
    finally{await context.close();}
  }));
  const failures=cleanup.filter(r=>r.status==="rejected");
  if(failures.length||report.roomsClosed!==report.roomsOpened)report.passed=false;
  report.recordedAt=new Date().toISOString();await browser.close();
  await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  if(failures.length)throw new AggregateError(failures.map(r=>r.reason),"Owned room cleanup failed");
  expect(report.roomsClosed).toBe(report.roomsOpened);
}
