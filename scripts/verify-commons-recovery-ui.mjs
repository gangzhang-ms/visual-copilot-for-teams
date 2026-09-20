import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import sharp from "sharp";
import {chromium,expect} from "@playwright/test";
import {builtUrl,buildRoot} from "./build-root.mjs";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const directory=resolve(".local","visual-context","commons-source-diagnosis");
const accepted=JSON.parse(await readFile(resolve(directory,"accepted-1.json"),"utf8"));
if(!accepted.success)throw new Error("Successful real-source native receipt is required.");
const response=await readFile(resolve(directory,"response-1.bin")),download=await readFile(resolve(directory,"download-1.bin"));
const expected=await readFile(resolve(directory,"preview-1.png"));
const {createLocalChatServer}=await import(builtUrl("local-chat-server.js"));
const {ongoingPersonalGenerationOptions}=await import(builtUrl("personal-image.js"));
const generated=await sharp({create:{width:1024,height:1024,channels:3,background:"#578"}}).png().toBuffer();
const report={externalRequests:0,azureRequests:0,replayedSourceRequests:0,stubTextRequests:0,stubImageRequests:0,passed:false,closed:false};
const app=await createLocalChatServer("OFFLINE-MODEL",{clientRoot:resolve(buildRoot,"client"),interaction:"direct-personal",
  creationChoices:true,mixedCreation:true,webCreation:true,cooldownMs:0,catalogSource:"original-demo",
  memeTransport:async()=>{throw new Error("Imgflip fallback forbidden");},
  webSearchTransport:async(raw,init)=>{
    const url=new URL(String(raw));report.replayedSourceRequests++;
    expect(init.redirect).toBe("error");expect(init.headers).not.toHaveProperty("X-Subscription-Token");
    if(url.origin+url.pathname==="https://commons.wikimedia.org/w/api.php"){
      expect(url.searchParams.get("gsrsearch")).toBe("coffee cup");expect(url.searchParams.get("gsrlimit")).toBe("3");
      return new Response(response,{headers:{"Content-Type":"application/json"}});
    }
    expect(url.href).toBe(accepted.item.thumbnailUrl);
    return new Response(download,{headers:{"Content-Type":"image/jpeg"}});
  },
  transport:async(_url,init)=>{
    report.stubTextRequests++;const body=JSON.parse(String(init.body)),input=JSON.parse(body.messages[1].content[0].text);
    expect(input.catalog).toHaveLength(3);
    expect(input.catalog[0].id).toBe(accepted.item.id);
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({id:input.catalog[0].id,reason:"Coffee fits the requested break."})}}]});
  },
  generation:{...ongoingPersonalGenerationOptions(),transport:async()=>{
    report.stubImageRequests++;return Response.json({data:[{b64_json:generated.toString("base64")}]});
  }}
});
const origin=await app.start(0),browser=await chromium.launch({channel:"msedge"});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),owned=ownedBrowserSession(page,origin);
await page.route("**/*",route=>{
  const url=new URL(route.request().url());
  if(["https:","http:"].includes(url.protocol)&&url.origin!==origin){report.externalRequests++;return route.abort();}
  return route.continue();
});
try{
  await owned.start();await page.goto(origin+"/chat");
  await page.locator(".local-composer").getByRole("button",{name:"Help me express",exact:true}).click();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await page.getByLabel("What would you like to express?",{exact:true}).fill("A coffee break after fictional work");
  await page.locator(".creation-advanced > summary").click();
  await page.getByLabel("Web search terms",{exact:true}).fill("coffee cup");
  await page.locator(".creation-advanced > summary").click();
  expect(report.replayedSourceRequests+report.stubImageRequests+report.stubTextRequests).toBe(0);
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready",{timeout:15000});
  const card=page.locator(".existing-candidate");
  await expect(card).toContainText("Wikimedia image + caption");
  const imagePath=await card.locator("img").getAttribute("src");
  expect(await(await page.request.get(origin+imagePath)).body()).toEqual(expected);
  await card.locator(".local-notices > summary").click();
  await expect(card.getByText("Julius Schorzman",{exact:true})).toBeVisible();
  await expect(card.getByText("CC BY-SA 2.0",{exact:true})).toBeVisible();
  await mkdir(resolve(directory,"ui"),{recursive:true});
  await page.screenshot({path:resolve(directory,"ui","actual-source-and-credit.png")});
  await card.getByRole("button",{name:"Use web preview + caption",exact:true}).click();
  await page.getByLabel("Caption beside image",{exact:true}).fill("Coffee break!");
  await page.getByRole("button",{name:"Preview web image + caption",exact:true}).click();
  await page.getByRole("button",{name:"Insert web preview + caption locally",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toContainText("Coffee break!");
  const state=await page.evaluate(async()=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    return (await fetch("/local/state",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"})).json();
  });
  expect(state.messages[0].visual.webSource.attribution).toEqual(accepted.visual.webSource.attribution);
  expect(state.messages[0].generated).toBeUndefined();
  Object.assign(report,{inserted:state.messages[0],sourceHashes:accepted.hashes});
  expect(report.replayedSourceRequests).toBe(2);expect(report.stubTextRequests).toBe(1);expect(report.stubImageRequests).toBe(2);
  expect(report.externalRequests).toBe(0);report.passed=true;
}finally{
  try{report.closed=(await owned.close()).closed;}
  finally{await context.close();await browser.close();await app.close();}
  report.recordedAt=new Date().toISOString();
  await writeFile(resolve(directory,"ui-report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({passed:report.passed,closed:report.closed,replayedSourceRequests:report.replayedSourceRequests,
    stubTextRequests:report.stubTextRequests,stubImageRequests:report.stubImageRequests,externalRequests:report.externalRequests,azureRequests:report.azureRequests}));
}
