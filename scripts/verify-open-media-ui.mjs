import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {resolve} from "node:path";
import sharp from "sharp";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const origin="http://127.0.0.1:4334",directory=resolve(".local","visual-context","open-media-validation");
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:"msedge"}),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
const owned=ownedBrowserSession(page,origin);
const report={origin,recordedAt:"",paidRoutes:0,sourceLoads:0,externalBrowserRequests:0,ownRoomClosed:false,passed:false};
page.on("request",r=>{
  const url=new URL(r.url());
  if(["/local/process","/local/generation/process"].includes(url.pathname))report.paidRoutes++;
  if(url.pathname==="/local/catalog/load")report.sourceLoads++;
  if(["http:","https:"].includes(url.protocol)&&url.origin!==origin)report.externalBrowserRequests++;
});
for(const path of ["process","generation/process","catalog/load"])await page.route(`**/local/${path}`,route=>route.abort());
async function api(path,body={}){
  return page.evaluate(async({path,body})=>{
    const s=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const r=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":s.csrf},body:JSON.stringify({revision:s.revision,...body})});
    return {status:r.status,value:await r.json()};
  },{path,body});
}
try{
  await owned.start();
  report.health=await (await page.request.get(origin+"/healthz")).json();
  expect(report.health).toMatchObject({ready:true,model:true,imageGeneration:"ready",sessionAdmission:"no-count-quota"});
  report.chatStatus=(await page.goto(origin+"/chat")).status();expect(report.chatStatus).toBe(200);
  await page.getByLabel("Language / 语言").selectOption("en");
  const composer=page.getByLabel("Message",{exact:true});await expect(composer).toBeEnabled();
  let seed=12345;const raw=Buffer.alloc(512*512*4);
  for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=i%4===3?255:seed>>>24;}
  const png=await sharp(raw,{raw:{width:512,height:512,channels:4}}).png().toBuffer();
  report.uploadBytes=png.length;expect(png.length).toBeLessThanOrEqual(1024*1024);
  await composer.evaluate((element,base64)=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),transfer=new DataTransfer();
    transfer.items.add(new File([bytes],"synthetic.png",{type:"image/png"}));
    element.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:transfer}));
  },png.toString("base64"));
  await expect(page.getByRole("button",{name:"Remove attachment",exact:true})).toBeVisible();
  await composer.fill("Original synthetic pixels 0");
  await page.getByRole("button",{name:"Add locally",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
  const first=(await api("state")).value.messages[0].id;
  for(let i=1;i<7;i++){
    const added=await api("message",{speaker:"Maya",text:`Original synthetic pixels ${i}`,attachment:{mime:"image/png",base64:png.toString("base64"),category:"image"}});
    expect(added.status).toBe(200);
  }
  const room=(await api("state")).value;
  report.mediaBytes=room.mediaBytes;report.retainedMessages=room.messages.length;report.originalRetained=room.messages[0].id===first;
  expect(room.mediaBytes).toBeGreaterThan(8*1024*1024);expect(room.messages).toHaveLength(7);expect(report.originalRetained).toBe(true);
  expect(room.providerRequests).toBe(0);
  await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByTestId("chat-message")).toHaveCount(7);
  for(const img of await page.locator("img.local-upload").all())await expect.poll(()=>img.evaluate(e=>e.complete&&e.naturalWidth===512)).toBe(true);
  await page.screenshot({path:resolve(directory,"large-room.png")});
  expect((await api("demo",{language:"en"})).status).toBe(400);
  expect((await api("state")).value.messages).toHaveLength(7);
  expect((await api("reset")).status).toBe(200);
  expect((await api("state")).value.mediaBytes).toBe(0);
  await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  await page.getByRole("button",{name:"Start a demo conversation",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(5);
  report.demo=(await api("state")).value.messages.map(m=>m.demoMedia??null);
  expect(report.demo).toEqual([null,"illustration","local-motion",null,null]);
  for(const img of await page.locator("img.local-upload").all())await expect.poll(()=>img.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  const gif=await readFile(resolve("assets","chat-demo","owl-motion.gif"));
  await composer.evaluate((element,base64)=>{
    const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],"owl.gif",{type:"image/gif"}));
    element.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer}));
  },gif.toString("base64"));
  await expect(page.getByRole("button",{name:"Remove attachment",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Remove attachment",exact:true}).click();
  await page.screenshot({path:resolve(directory,"demo-and-composer.png")});
  expect(report.paidRoutes+report.sourceLoads+report.externalBrowserRequests).toBe(0);
  expect((await api("state")).value.providerRequests).toBe(0);report.passed=true;
}finally{
  try{report.ownRoomClosed=(await owned.close()).closed;expect(report.ownRoomClosed).toBe(true);}
  finally{
    await context.close();await browser.close();report.recordedAt=new Date().toISOString();
    await writeFile(resolve(directory,"real-ui-report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
  }
}
