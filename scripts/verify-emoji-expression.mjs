import {mkdir,open,writeFile,readFile,readdir} from "node:fs/promises";
import {resolve,join,relative} from "node:path";
import {createHash} from "node:crypto";
import {chromium,expect} from "@playwright/test";
import sharp from "sharp";
import {buildRoot,builtUrl} from "./build-root.mjs";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const live=process.argv[2]==="--live-once";
if(!live&&process.argv[2]!=="--offline")throw new Error("Explicit canary mode required");
let key=process.env.MODEL_API_KEY;delete process.env.MODEL_API_KEY;delete process.env.SERPAPI_API_KEY;
const dir=resolve(".local","visual-context",live?"emoji-expression-live":"emoji-expression-offline");
const report={live,startedAt:new Date().toISOString(),textAttempts:0,dispatched:0,imageCalls:0,searchCalls:0,downloadCalls:0,
  forbiddenCalls:0,browserExternalRequests:0,passed:false,phase:"prepare",requests:[],closed:false};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const check=(ok,code)=>{if(!ok)throw new Error(code);};
async function save(name,value){
  const text=Buffer.isBuffer(value)?value:JSON.stringify(value,null,2);
  check(!key||!text.toString().includes(key),"secret-boundary");
  await writeFile(resolve(dir,name),text);
}
let app,browser,owned,page,origin;
const pending=[];
const fakeOptions={options:[
  {emojis:["😮‍💨","🤝"],label:"Shared sigh",reason:"Acknowledge the growing task list and show solidarity.",caution:"A sigh may sound negative without context.",text:"I hear you."},
  {emojis:["🙃","💪"],label:"Gentle irony",reason:"Mirror the light irony while encouraging them.",caution:"Irony may be misread.",text:"One step at a time."},
  {emojis:["🫂","❤️"],label:"Warm support",reason:"Offer comfort rather than make light of it.",caution:"A hug can feel too familiar.",text:"Here for you."}
]};
async function api(path,body={}){
  return page.evaluate(async({path,body})=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
      body:JSON.stringify({revision:session.revision,...body})});
    if(!response.ok)throw new Error("owned-route-failed");
    return response.json();
  },{path,body});
}
try{
  check(key&&buildRoot.endsWith("dist-chat-emoji-express"),"configuration");
  await mkdir(dir,{recursive:true});
  if(live){const marker=await open(resolve(dir,"attempt.json"),"wx");try{await marker.writeFile(JSON.stringify({at:report.startedAt,maxText:2,maxImages:0,maxSearch:0,maxDownloads:0}));}finally{await marker.close();}}
  const files=[];
  async function manifest(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
    const path=join(folder,entry.name);if(entry.isDirectory())await manifest(path);else{const bytes=await readFile(path);files.push({path:relative(buildRoot,path),bytes:bytes.length,sha256:hash(bytes)});}
  }}
  await manifest(resolve(buildRoot,"client"));await manifest(resolve(buildRoot,"server"));files.sort((a,b)=>a.path.localeCompare(b.path));
  report.build={root:buildRoot,sha256:hash(JSON.stringify(files))};await save("build-manifest.json",{...report.build,files});
  const {createLocalChatServer}=await import(builtUrl("local-chat-server.js"));
  const forbidden=async()=>{report.forbiddenCalls++;await save("report.json",report);throw new Error("forbidden-nontext-transport");};
  app=await createLocalChatServer(key,{clientRoot:resolve(buildRoot,"client"),interaction:"direct-personal",emojiExpressions:true,
    creationChoices:true,mixedCreation:true,contextualCreation:true,webCreation:true,webProvider:"serpapi",catalogSource:"original-demo",
    cooldownMs:live?6100:0,memeTransport:forbidden,webSearchTransport:forbidden,generation:{transport:forbidden},
    transport:async(url,init)=>{
      const endpoint=new URL(String(url));
      check(endpoint.origin==="https://your-azure-openai-resource.openai.azure.com"
        &&endpoint.pathname==="/openai/deployments/your-vision-deployment/chat/completions"
        &&endpoint.searchParams.get("api-version")==="2024-10-21","text-endpoint");
      const index=++report.textAttempts;check(index<=2,"text-budget");
      const request=JSON.parse(String(init.body)),content=request.messages[1].content,payload=JSON.parse(content[0].text);
      await save(`text-request-${index}.json`,request);
      check(content.length===1&&content[0].type==="text","text-only");
      check(payload.task===(index===1?"explain":"express-unicode-emoji"),"one-call-per-task");
      check(payload.context.length<=10,"context-bound");
      const expected="🙃 😮‍💨";
      check(index===1?payload.target.kind==="emoji"&&payload.target.emoji===expected:
        payload.replyTo?.emoji===expected&&payload.replyTo.text==="Maya: Another task just arrived 🙃😮‍💨","target-binding");
      report.requests.push({index,task:payload.task,apiVersion:endpoint.searchParams.get("api-version"),contextCount:payload.context.length});
      await save("report.json",report);
      const started=performance.now();let response;
      if(live){report.dispatched++;await save("report.json",report);response=await fetch(url,init);}
      else{
        const value=index===1?{background:{source:null,context:null,frames:[]},observations:[{text:expected,frames:[]}],
          commonUsage:["An upside-down smile can signal irony; a sigh can signal tiredness or relief."],
          contextualInterpretations:[{text:"The growing task list makes weary humor plausible.",context:payload.context.map(c=>c.label)}],
          uncertainties:["It could also be playful, not frustration."],safeResponseGuidance:["Offer gentle support."]}:fakeOptions;
        response=Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]});
      }
      const reader=response.body.getReader(),chunks=[];let total=0;
      try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;check(total<=128*1024,"response-bound");chunks.push(part.value);}}
      finally{await reader.cancel();reader.releaseLock();}
      const bytes=Buffer.concat(chunks);
      await save(`text-response-${index}.json`,bytes);
      Object.assign(report.requests.at(-1),{status:response.status,elapsedMs:Math.round(performance.now()-started)});
      await save("report.json",report);
      return new Response(bytes,{status:response.status,headers:{"content-type":"application/json",...(response.headers.get("retry-after")?{"retry-after":response.headers.get("retry-after")}:{})}});
    }
  });
  origin=await app.start(0);report.phase="browser";browser=await chromium.launch({channel:"msedge"});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});page=await context.newPage();page.setDefaultTimeout(60_000);
  owned=ownedBrowserSession(page,origin);await owned.start();
  await page.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.browserExternalRequests++;return route.abort();}
    return route.continue();
  });
  page.on("response",response=>{
    const path=new URL(response.url()).pathname;
    if(["/local/process","/local/emoji/suggest","/local/emoji/selection"].includes(path)&&response.ok()){
      pending.push(response.json().then(value=>save(path.endsWith("/process")?"explain-result.json":path.endsWith("/suggest")?"emoji-result.json":"selection-result.json",value)));
    }
  });
  await page.goto(origin+"/chat");await page.locator(".local-composer textarea").waitFor();
  await api("message",{speaker:"Alex",text:"My to-do list keeps growing."});
  await api("message",{speaker:"Maya",text:"Another task just arrived 🙃😮‍💨"});
  const source=await api("state");await save("owned-context.json",{messages:source.messages});await page.reload();
  report.phase="explain";
  await page.getByTestId("chat-message").filter({hasText:"Another task just arrived"}).getByRole("button",{name:"Explain",exact:true}).click();
  await expect(page.locator(".explanation-common")).toBeVisible({timeout:90_000});
  await Promise.all(pending);await page.screenshot({path:resolve(dir,"explain.png"),fullPage:true});
  check(report.textAttempts===1&&report.requests[0].status===200,"explain-failed");
  await page.locator(".local-tabs").getByRole("button",{name:"Express",exact:true}).click();
  await page.getByRole("radio",{name:"Unicode emoji",exact:true}).check();
  await page.getByLabel("Reply to message",{exact:true}).selectOption(source.messages[1].id);
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Reply with gentle solidarity and a little weary humor, not dismissive. Use short emoji combinations.");
  await page.getByLabel("Message",{exact:true}).fill("I hear you.");
  const image=await sharp({create:{width:24,height:24,channels:3,background:"#459"}}).png().toBuffer();
  await page.locator(".local-composer input[type=file]").setInputFiles({name:"owned-geometric-draft.png",mimeType:"image/png",buffer:image});
  if(live)await new Promise(done=>setTimeout(done,6200));
  report.phase="express";await page.getByRole("button",{name:"Suggest emoji",exact:true}).click();
  await expect(page.locator(".emoji-options article")).toHaveCount(3,{timeout:90_000});
  await Promise.all(pending);await page.screenshot({path:resolve(dir,"suggestions.png"),fullPage:true});
  const result=JSON.parse(await readFile(resolve(dir,"emoji-result.json"),"utf8"));
  await page.getByRole("button",{name:"Choose option 1",exact:true}).click();
  const expected=result.suggestions.options[0].emojis.join("");
  await expect(page.locator(".emoji-insertion")).toHaveText(expected);
  await page.screenshot({path:resolve(dir,"preview.png"),fullPage:true});
  await page.getByRole("button",{name:"Insert into composer",exact:true}).click();
  await expect(page.getByLabel("Message",{exact:true})).toHaveValue("I hear you. "+expected);
  await expect(page.locator(".composer-attachment img")).toBeVisible();
  const state=await api("state");
  report.result={explain:JSON.parse(await readFile(resolve(dir,"explain-result.json"),"utf8")),options:result.suggestions.options,
    inserted:await page.getByLabel("Message",{exact:true}).inputValue(),preservedDraft:true,preservedAttachment:true,
    messagesBefore:source.messages.length,messagesAfter:state.messages.length};
  await save("result.json",report.result);await page.screenshot({path:resolve(dir,"inserted-not-sent.png"),fullPage:true});
  check(state.messages.length===source.messages.length&&report.textAttempts===2&&report.requests.every(r=>r.status===200)
    &&report.forbiddenCalls===0&&report.browserExternalRequests===0,"acceptance");
  report.passed=true;report.phase="complete";
}catch(error){
  report.failure={phase:report.phase,kind:error instanceof Error?error.name:"unknown"};
  process.exitCode=1;
}finally{
  await Promise.allSettled(pending);
  if(page&&!report.passed)await page.screenshot({path:resolve(dir,"failure.png"),fullPage:true}).catch(()=>{report.screenshotFailed=true;});
  await save("report.json",report);
  if(owned)try{report.cleanup=await owned.close();report.closed=report.cleanup.closed;}catch{report.cleanupFailed=true;process.exitCode=1;}
  if(browser)await browser.close();if(app)await app.close();
  await save("report.json",report);key=null;
  console.log(JSON.stringify({live,passed:report.passed,phase:report.phase,textAttempts:report.textAttempts,dispatched:report.dispatched,
    imageCalls:0,searchCalls:0,downloadCalls:0,closed:report.closed,evidence:dir}));
}
