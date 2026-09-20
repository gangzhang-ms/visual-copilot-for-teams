import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ownedBrowserSession} from "./local-browser-session.mjs";

const origin="http://127.0.0.1:4341",directory=resolve(".local","visual-context","english-validation");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin),report={origin,paidRoutes:0,sourceLoads:0,externalRequests:0,closed:false,passed:false};
await page.route("**/*",async route=>{
  const url=new URL(route.request().url());
  if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalRequests++;return route.abort();}
  if(["/local/process","/local/generation/process"].includes(url.pathname)){report.paidRoutes++;return route.abort();}
  if(url.pathname==="/local/catalog/load"){report.sourceLoads++;return route.abort();}
  return route.continue();
});
try{
  await owned.start();report.health=await (await page.request.get(origin+"/healthz")).json();
  await page.goto(origin+"/chat");
  await expect(page.locator("html")).toHaveAttribute("lang","en");
  await expect(page.getByLabel("Language / 语言")).toHaveValue("en");
  await page.getByRole("button",{name:"Start a demo conversation",exact:true}).click();
  await expect(page.getByTestId("chat-message").first()).toContainText("The login fix is in.");
  await page.evaluate(async()=>{
    let session=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const headers={"Content-Type":"application/json","X-Local-CSRF":session.csrf};
    for(let i=5;i<14;i++){
      const response=await fetch("/local/message",{method:"POST",headers,body:JSON.stringify({revision:session.revision,speaker:"Alex",text:`Original fictional context ${i}`})});
      if(!response.ok)throw new Error("Synthetic message setup failed");
      session={...session,...await response.json()};
    }
  });
  await page.reload();await expect(page.getByTestId("chat-message")).toHaveCount(14);
  await expect(page.getByLabel("Language / 语言")).toHaveValue("en");
  await page.locator(".local-composer").getByRole("button",{name:"Help me express",exact:true}).click();
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Thank a fictional colleague");
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await expect(page.getByRole("button",{name:"Generate image",exact:true})).toBeEnabled();
  await page.locator(".creation-advanced > summary").click();
  await page.getByText("Audience preferences & context",{exact:true}).click();
  await expect(page.getByRole("checkbox",{name:/Include context/})).toHaveCount(10);
  await expect(page.getByLabel("Context 1",{exact:true})).toHaveValue("Alex: Deal. Tomorrow it is.");
  report.review=await page.evaluate(async()=>{
    const session=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const headers={"Content-Type":"application/json","X-Local-CSRF":session.csrf};
    const state=await (await fetch("/local/state",{method:"POST",headers,body:"{}"})).json();
    const draft={intent:"Thank a fictional colleague",creative:"",output:"image",expression:{style:"auto",intensity:"auto",reference:""},
      context:state.messages.slice(-10).map(m=>({label:m.id,text:`${m.speaker}: ${m.text}`,included:true})),
      preferences:{source:"requester-reported",language:"en",culture:"",familiarity:"",tone:"",relationship:"",humor:"",avoid:""}};
    const response=await fetch("/local/generation/review",{method:"POST",headers,body:JSON.stringify({revision:state.revision,draftRevision:0,draft})});
    if(!response.ok)throw new Error("Synthetic non-dispatch review failed");
    const review=await response.json(),payload=JSON.parse(review.prompt.split("\n").at(-1));
    return {status:response.status,contextCount:payload.context.length,language:payload.requesterOrAudiencePreferences.language,roomMessages:state.messages.length};
  });
  expect(report.review).toEqual({status:200,contextCount:10,language:"en",roomMessages:14});
  await page.locator(".creation-advanced > summary").click();
  await page.screenshot({path:resolve(directory,"english-desktop.png")});
  await page.setViewportSize({width:320,height:900});
  await page.getByRole("button",{name:"Generate image",exact:true}).scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:resolve(directory,"english-mobile.png")});
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang","zh-CN");
  await expect(page.getByLabel("你想表达什么？",{exact:true})).toHaveValue("Thank a fictional colleague");
  await expect(page.getByTestId("chat-message")).toHaveCount(14);
  expect(report.paidRoutes+report.sourceLoads+report.externalRequests).toBe(0);
  report.passed=true;
}finally{
  try{report.closed=(await owned.close()).closed;expect(report.closed).toBe(true);}
  finally{await context.close();await browser.close();}
  report.recordedAt=new Date().toISOString();
  await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
