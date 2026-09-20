import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {chromium,expect} from "@playwright/test";
import {ownedBrowserSession} from "./local-browser-session.mjs";

const evidence=resolve(".local","visual-context","source-clarity");
const previous=resolve(".local","visual-context","contextual-quality-reply-live");
const receipt=JSON.parse(await readFile(resolve(previous,"report.json"),"utf8"));
const capture=JSON.parse(await readFile(resolve(previous,"public-search-results.json"),"utf8"));
const source=await readFile(resolve(previous,"source-download.bin"));
const originals=await Promise.all([1,2].map(i=>readFile(resolve(previous,`image-provider-${i}-0.png`))));
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const report={actualAzureCalls:0,actualSearchCalls:0,actualThumbnailDownloads:0,externalBrowserRequests:0,runs:[]};
const browser=await chromium.launch({channel:"msedge"});
await mkdir(evidence,{recursive:true});
async function run(root,label){
  const built=file=>pathToFileURL(resolve(root,"server",file)).href;
  const {createLocalChatServer}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const counts={text:0,image:0,searchReplay:0,thumbnailReplay:0};
  let selectedThumbnail;
  const app=await createLocalChatServer("OFFLINE-CLARITY",{clientRoot:resolve(root,"client"),interaction:"direct-personal",
    creationChoices:true,mixedCreation:true,webCreation:true,contextualCreation:true,webProvider:"serpapi",
    webSearchKey:"OFFLINE-SEARCH",cooldownMs:0,catalogSource:"original-demo",
    memeTransport:async()=>{throw new Error("Unexpected transport");},
    transport:async(_url,init)=>{
      counts.text++;
      const input=JSON.parse(JSON.parse(init.body).messages[1].content[0].text);
      const value=input.task==="plan-contextual-expression"
        ?{...receipt.anchorPlan,visualStyle:"unknown",mode:"override",observedSources:[],evidence:[]}
        :receipt.selection;
      if(input.catalog){
        const selected=input.catalog.find(item=>item.id===receipt.selection.id);
        expect(selected).toBeTruthy();
      }
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]});
    },
    webSearchTransport:async(raw,init)=>{
      const url=new URL(String(raw));
      expect(init.redirect).toBe("error");expect(init.credentials).toBe("omit");
      if(url.origin==="https://serpapi.com"&&url.pathname==="/search"){
        counts.searchReplay++;expect(url.searchParams.get("q")).toBe(receipt.publicQuery);
        return Response.json({search_metadata:{status:capture.status},images_results:capture.images_results});
      }
      expect(url.hostname).toBe("encrypted-tbn0.gstatic.com");
      expect(url.pathname).toBe("/images");
      expect(capture.images_results.some(row=>row.thumbnail===url.href)).toBe(true);
      expect(init.headers).toEqual({Accept:"image/png,image/jpeg"});
      selectedThumbnail=url.href;counts.thumbnailReplay++;
      return new Response(source,{headers:{"Content-Type":"image/jpeg"}});
    },
    generation:{...ongoingPersonalGenerationOptions(),transport:async()=>{
      const bytes=originals[counts.image++];expect(bytes).toBeTruthy();
      return Response.json({data:[{b64_json:bytes.toString("base64")}]});
    }}
  });
  const origin=await app.start(0),context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
  const owned=ownedBrowserSession(page,origin),result={root,label,counts,passed:false};
  await page.route("**/*",route=>{
    if(new URL(route.request().url()).origin!==origin){report.externalBrowserRequests++;return route.abort();}
    return route.continue();
  });
  try{
    await owned.start();await page.goto(origin+"/chat");
    await page.locator(".local-tabs").getByRole("button",{name:"Express",exact:true}).click();
    await page.getByRole("radio",{name:"Create a new image",exact:true}).check();
    await page.getByLabel("What would you like to express?",{exact:true}).fill("Gandalf is exhausted after endless work");
    expect(counts.text+counts.image+counts.searchReplay+counts.thumbnailReplay).toBe(0);
    await page.getByRole("button",{name:"Create 3 options",exact:true}).click();
    await expect(page.locator(".generation-batch")).toContainText("3 of 3 ready",{timeout:20000});
    const card=page.locator(".existing-candidate"),image=card.locator("img");
    await expect(image).toHaveJSProperty("complete",true);
    const bytes=await(await page.request.get(origin+await image.getAttribute("src"))).body(),meta=await sharp(bytes).metadata();
    await writeFile(resolve(evidence,`${label}-preview.png`),bytes);
    result.pixels={width:meta.width,height:meta.height,bytes:bytes.length,sha256:hash(bytes)};
    result.cardBox=await image.boundingBox();
    await card.screenshot({path:resolve(evidence,`${label}-card.png`)});
    if(label==="after"){
      expect(meta).toMatchObject({width:638,height:480});
      expect(await sharp(bytes).raw().toBuffer()).toEqual(await sharp(source).raw().toBuffer());
      result.exactDownloadedPixels=true;
      const inspection=card.getByRole("button",{name:"Inspect downloaded pixels",exact:true});
      await inspection.click();
      const dialog=page.getByRole("dialog",{name:"Downloaded image preview",exact:true});
      await expect(dialog).toBeVisible();
      result.inspectorBox=await dialog.locator("img").boundingBox();
      expect(result.inspectorBox.width).toBe(638);expect(result.inspectorBox.height).toBe(480);
      await dialog.screenshot({path:resolve(evidence,"actual-pixel-inspection.png")});
      await page.keyboard.press("Escape");await expect(inspection).toBeFocused();
    }else expect(meta).toMatchObject({width:512,height:385});
    await card.getByRole("button",{name:"Use web preview + caption",exact:true}).click();
    await page.getByLabel("Caption beside image",{exact:true}).fill("Work work. Captured source replay.");
    await page.getByRole("button",{name:"Preview web image + caption",exact:true}).click();
    await page.getByRole("button",{name:"Insert web preview + caption locally",exact:true}).click();
    await expect(page.getByTestId("chat-message")).toContainText("Captured source replay.");
    const inserted=page.getByTestId("chat-message").locator(".local-art");
    expect(await(await page.request.get(origin+await inserted.getAttribute("src"))).body()).toEqual(bytes);
    result.insertedPixelsUnchanged=true;
    expect(counts).toEqual({text:2,image:2,searchReplay:1,thumbnailReplay:1});
    result.thumbnailHost=new URL(selectedThumbnail).hostname;
    result.passed=true;
  }finally{
    try{result.ownRoomClosed=(await owned.close()).closed;}
    finally{await context.close();await app.close();report.runs.push(result);}
  }
}
try{
  await run("dist-chat-contextual-reply","before");
  await run("dist-chat-source-clarity","after");
  expect(report.externalBrowserRequests).toBe(0);
}finally{
  await browser.close();await writeFile(resolve(evidence,"replay-report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
