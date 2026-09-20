import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
let app:Awaited<ReturnType<typeof Factory>>,origin:string,requests:string[],outputs:unknown[],diagnostics:unknown[];
let failure:"named-background"|"foreign-context"|"fake-frame"|undefined;
const current=process.env.VISUAL_BUILD_ROOT??"dist",directory=resolve(".local","visual-context","emoji-reference-fix");
test.beforeEach(async({},info)=>{
  const legacy=info.title.startsWith("legacy4359");
  if(legacy)test.skip(!existsSync(resolve("dist-chat-emoji-recognition","server","local-chat-server.js")),"Optional preserved4359 build not present");
  const root=legacy?"dist-chat-emoji-recognition":current,built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  requests=[];outputs=[];diagnostics=[];failure=legacy?"named-background":undefined;
  app=await createLocalChatServer("OFFLINE",{clientRoot:resolve(root,"client"),interaction:"direct-personal",emojiExpressions:true,
    cooldownMs:0,catalogSource:"original-demo",modelDiagnostic:event=>diagnostics.push(event),
    memeTransport:async()=>{throw new Error("Unexpected download");},
    transport:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.messages[1].content[0].text);      requests.push(JSON.stringify(body));
      const output={
        background:failure==="named-background"?{source:"Unicode emoji",context:"Standard character symbols",frames:[]}:{source:null,context:null,frames:[]},
        observations:[{text:"Folded hands can indicate thanks, a request or prayer.",frames:failure==="fake-frame"?["f0"]:[]}],
        commonUsage:["A slight smile can be friendly or restrained."],
        contextualInterpretations:[{text:"This may be a thankful response.",context:[failure==="foreign-context"?"c99":payload.context[2].label]},
          {text:"It could also soften a request.",context:[payload.context[4].label]}],
        uncertainties:["Shared usage and tone can differ; sender intent is not confirmed."],safeResponseGuidance:["Ask what they meant if unclear."]
      };
      outputs.push(output);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]});
    }});
  origin=await app.start(0);
});
test.afterEach(async()=>{await app?.close();});
async function seed(page:Page,emoji="🙏🙂"){
  await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
  await page.evaluate(async emoji=>{
    const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const headers={"Content-Type":"application/json","X-Local-CSRF":session.csrf};
    let state=session;
    for(const [speaker,text] of [["Alex","The test puzzle is ready."],["Leo","An earlier quoted example 👀"],
      ["Maya",`Thank you? ${emoji}`],["Alex","We can check what you meant."],["Leo","There is no rush."]]){
      const response=await fetch("/local/message",{method:"POST",headers,body:JSON.stringify({revision:state.revision,speaker,text})});
      if(!response.ok)throw new Error("Fixture setup failed");state=await response.json();
    }
  },emoji);
  await page.reload();await expect(page.getByTestId("chat-message")).toHaveCount(5);
}
async function explain(page:Page){
  const response=page.waitForResponse(r=>r.url().endsWith("/local/process"));
  await page.getByTestId("chat-message").filter({hasText:"Thank you?"}).getByRole("button",{name:"Explain",exact:true}).click();
  const received=await response;
  return {status:received.status(),body:await received.json()};
}
test("legacy4359 reproduces reported reference error with zero unknown IDs",async({page})=>{
  await seed(page);const result=await explain(page);
  await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,"legacy-route-reproduction.json"),JSON.stringify({synthetic:true,  request:JSON.parse(requests[0]),
    providerOutput:outputs[0],diagnostics,result},null,2));
  expect(result.status).toBe(400);expect(result.body.code).toBe("model-output-invalid-references");
  expect(diagnostics[0]).toMatchObject({images:0,contexts:5,finishReason:"stop",references:{
    background:{references:0,unknown:0},frames:{items:1,references:0,unknown:0},context:{items:2,references:2,unknown:0}}});
  expect(JSON.parse(requests[0]).response_format.json_schema.schema.properties.background.properties.source.enum).toBeUndefined();
  await expect(page.getByRole("alert")).toContainText("outside your selection");
  expect(requests).toHaveLength(1);
});
for(const emoji of ["🙏","🙏🙂","👩🏽‍💻❤️🇺🇳1️⃣"])test(`fixed route maps selected Unicode evidence and five reviewed contexts for ${emoji}`,async({page})=>{
  await seed(page,emoji);const result=await explain(page);
  await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,`fixed-route-${emoji==="🙏"?1:emoji==="🙏🙂"?2:3}.json`),
    JSON.stringify({synthetic:true,    request:JSON.parse(requests[0]),providerOutput:outputs[0],diagnostics,result},null,2));
  expect(result.status).toBe(200);
  const request=JSON.parse(requests[0]),payload=JSON.parse(request.messages[1].content[0].text),schema=request.response_format.json_schema.schema.properties;
  expect(request.messages[1].content).toHaveLength(1);expect(payload.frames).toEqual([]);
  expect(payload.target.emoji.replaceAll(" ","")).toBe(emoji);expect(payload.target.emoji).not.toContain("👀");
  expect(schema.background.properties.source.enum).toEqual([null]);expect(schema.background.properties.context.enum).toEqual([null]);
  expect(schema.background.properties.frames.maxItems).toBe(0);expect(schema.observations.items.properties.frames.maxItems).toBe(0);
  expect(schema.contextualInterpretations.items.properties.context.items.enum).toEqual(["c0","c1","c2","c3","c4"]);
  const ids=result.body.state.messages.map((m:{id:string})=>m.id);
  expect(result.body.result.explanation.contextualInterpretations.map((entry:{context:string[]})=>entry.context)).toEqual([[ids[2]],[ids[4]]]);
  await expect(page.locator(".explanation-common")).toBeVisible();expect(requests).toHaveLength(1);
});
for(const kind of ["named-background","foreign-context","fake-frame"] as const)test(`fixed route still rejects ${kind} without sanitizing or retrying`,async({page})=>{
  failure=kind;await seed(page);const result=await explain(page);
  expect(result.status).toBe(400);expect(result.body.code).toBe("model-output-invalid-references");
  await expect(page.locator(".explanation-common")).toHaveCount(0);expect(requests).toHaveLength(1);
});
