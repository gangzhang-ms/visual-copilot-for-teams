import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import {chromium,expect} from "@playwright/test";
import {builtUrl,buildRoot} from "./build-root.mjs";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const directory=resolve(".local","visual-context","serpapi-source-acceptance","live-fixed");
const live=JSON.parse(await readFile(resolve(directory,"report.json"),"utf8"));
expect(live.passed).toBe(true);
const items=JSON.parse(await readFile(resolve(directory,"accepted-items.json"),"utf8"));
const capture=JSON.parse(await readFile(resolve(directory,"public-response.json"),"utf8"));
const {parseSerpImages}=await import(pathToFileURL(resolve(directory,"..","server","provider.mjs")).href);
const rows=capture.images_results.map(row=>({title:row.title,thumbnail:row.thumbnail.fullUrl,
  link:row.link.url,...(row.original?{original:row.original.url}:{})}));
expect(rows).toHaveLength(100);
expect(rows.every(row=>!row.thumbnail.startsWith("https://serpapi.com/"))).toBe(true);
expect(parseSerpImages({search_metadata:{status:"Success"},images_results:rows})).toHaveLength(10);
const download=await readFile(resolve(directory,"download.bin")),expected=await readFile(resolve(directory,"preview.png"));
const response={search_metadata:{status:"Success"},images_results:items.map(item=>({
  title:item.title,thumbnail:item.thumbnailUrl,link:item.sourcePageUrl,original:item.imageUrl
}))};
const {createLocalChatServer}=await import(builtUrl("local-chat-server.js"));
const {ongoingPersonalGenerationOptions}=await import(builtUrl("personal-image.js"));
const generated=await sharp({create:{width:1024,height:1024,channels:3,background:"#578"}}).png().toBuffer();
const report={externalRequests:0,azureRequests:0,replayedSourceRequests:0,stubTextRequests:0,stubImageRequests:0,
  actualCapturedRows:rows.length,passed:false,closed:false};
const app=await createLocalChatServer("OFFLINE-MODEL",{clientRoot:resolve(buildRoot,"client"),interaction:"direct-personal",
  creationChoices:true,mixedCreation:true,webCreation:true,webProvider:"serpapi",webSearchKey:"OFFLINE-REPLAY",
  cooldownMs:0,catalogSource:"original-demo",memeTransport:async()=>{throw new Error("No fallback");},
  webSearchTransport:async(raw,init)=>{
    const url=new URL(String(raw));report.replayedSourceRequests++;
    expect(init.redirect).toBe("error");expect(init.credentials).toBe("omit");
    if(url.origin+url.pathname==="https://serpapi.com/search"){
      expect(url.searchParams.get("q")).toBe(live.syntheticQuery);
      return Response.json(response);
    }
    expect(url.href).toBe(items[0].thumbnailUrl);
    expect(JSON.stringify(init.headers)).not.toContain("OFFLINE-REPLAY");
    return new Response(download,{headers:{"Content-Type":live.thumbnailContentType}});
  },
  transport:async(_url,init)=>{
    report.stubTextRequests++;
    const input=JSON.parse(JSON.parse(String(init.body)).messages[1].content[0].text);
    expect(input.catalog).toHaveLength(10);
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({id:input.catalog[0].id,reason:"Fits the synthetic relief intent."})}}]});
  },
  generation:{...ongoingPersonalGenerationOptions(),transport:async()=>{
    report.stubImageRequests++;return Response.json({data:[{b64_json:generated.toString("base64")} ]});
  }}
});
const origin=await app.start(0),browser=await chromium.launch({channel:"msedge"});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),owned=ownedBrowserSession(page,origin);
await page.route("**/*",route=>{
  const url=new URL(route.request().url());
  if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalRequests++;return route.abort();}
  return route.continue();
});
try{
  await owned.start();await page.goto(origin+"/chat");
  await page.locator(".local-composer").getByRole("button",{name:"Help me express",exact:true}).click();
  await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Relief after fictional work");
  await page.locator(".creation-advanced > summary").click();
  await page.getByLabel("Web search terms",{exact:true}).fill(live.syntheticQuery);
  await page.locator(".creation-advanced > summary").click();
  expect(report.replayedSourceRequests+report.stubTextRequests+report.stubImageRequests).toBe(0);
  await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
  await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready",{timeout:15000});
  const card=page.locator(".existing-candidate");
  expect(await(await page.request.get(origin+await card.locator("img").getAttribute("src"))).body()).toEqual(expected);
  await card.getByRole("button",{name:"Use web preview + caption",exact:true}).click();
  await page.getByLabel("Caption beside image",{exact:true}).fill("Finally, a moment to breathe!");
  await page.getByRole("button",{name:"Preview web image + caption",exact:true}).click();
  await page.getByRole("button",{name:"Insert web preview + caption locally",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toContainText("Finally, a moment to breathe!");
  const state=await page.evaluate(async()=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    return(await fetch("/local/state",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},body:"{}"})).json();
  });
  expect(state.messages[0].visual.webSource).toMatchObject({provider:"Google Images via SerpApi",title:items[0].title,pageUrl:items[0].sourcePageUrl});
  expect(state.messages[0].visual.webSource.attribution).toBeUndefined();
  expect(state.messages[0].visual.notices.license).toContain("does not grant");
  expect(state.messages[0].generated).toBeUndefined();
  expect(report.replayedSourceRequests).toBe(2);expect(report.stubTextRequests).toBe(1);
  expect(report.stubImageRequests).toBe(2);expect(report.externalRequests).toBe(0);
  await page.screenshot({path:resolve(directory,"inserted-replay.png")});
  report.passed=true;
}finally{
  try{report.closed=(await owned.close()).closed;}
  finally{await context.close();await browser.close();await app.close();}
  report.recordedAt=new Date().toISOString();
  await writeFile(resolve(directory,"ui-report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
