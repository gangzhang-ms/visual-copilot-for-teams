import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import {emptySpeakerProfile} from "../../src/shared/expression";
import {openCreationOptions} from "../expression-ui";
let app:Awaited<ReturnType<typeof Factory>>,origin:string,explainInputs:Record<string,unknown>[],images:string[],sourceRequests:{url:string;body:unknown}[],png:Buffer;
const root=process.env.VISUAL_BUILD_ROOT??"dist",built=(name:string)=>pathToFileURL(resolve(root,"server",name)).href;
test.beforeEach(async()=>{
  explainInputs=[];images=[];sourceRequests=[];
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  png=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#eeeecc"/><circle cx="300" cy="400" r="200" fill="#336699"/><rect x="550" y="500" width="200" height="300" fill="#dd8877"/></svg>')).png().toBuffer();
  app=await createLocalChatServer("OFFLINE-SCOPE-BOUNDARY",{interaction:"direct-personal",creationChoices:true,cooldownMs:0,catalogSource:"original-demo",clientRoot:resolve(root,"client"),
    memeTransport:async(url,init)=>{
      sourceRequests.push({url:String(url),body:init?.body});
      return Response.json({success:true,data:{memes:Array.from({length:15},(_,i)=>({
        id:i===14?"87743020":String(100+i),name:i===14?"Two Buttons":`Unrelated fixture ${i}`,
        url:`https://i.imgflip.com/a${i}.png`,width:300,height:300,box_count:2
      }))}});
    },
    generation:{...ongoingPersonalGenerationOptions(),transport:async(_url,init)=>{
      images.push(String(init?.body));return Response.json({data:[{b64_json:png.toString("base64")}]});
    }},
    transport:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)),input=JSON.parse(body.messages[1].content[0].text);explainInputs.push(input);
      expect(body.response_format.json_schema.name).toBe("visual_explanation_v2");
      expect(body.response_format.json_schema.schema.required.slice().sort()).toEqual(["background","commonUsage","contextualInterpretations","observations","safeResponseGuidance","uncertainties"]);
      expect(JSON.stringify(body)).not.toContain("publicTextInspiration");
      expect(JSON.stringify(body)).not.toContain("Imgflip");
      const en=input.preferences.outputLanguage==="en";
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        background:{source:null,context:null,frames:[]},
        observations:[{text:en?"Two geometric shapes.":"两个几何形状。",frames:input.frames.map((f:{id:string})=>f.id)}],
        commonUsage:[en?"A comparison between two alternatives.":"两种选择的对比。"],
        contextualInterpretations:[{text:en?"It may express hesitation between the two options.":"可能是在表达对两种选择的犹豫。",context:input.context.map((c:{label:string})=>c.label)}],
        uncertainties:[en?"The sender's intent is uncertain.":"发言者的意图不确定。"],
        safeResponseGuidance:[en?"Ask which option they prefer.":"问问对方更倾向哪种选择。"]
      })}}]});
    }
  });origin=await app.start(0);
});
test.afterEach(async()=>{await app.close();});
async function api(page:Page,path:string,body:object={}){
  return page.evaluate(async({path,body})=>{
    const session=await (await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
      body:JSON.stringify({revision:session.revision,...body})});
    if(!response.ok)throw new Error("Offline room setup failed");
    return response.json();
  },{path,body});
}
for(const language of ["en","zh-CN"] as const)test(`${language}: Explain stays explanation-only; only Express Generate searches inspiration and creates options`,async({page})=>{
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  await page.setViewportSize({width:1440,height:950});await page.goto(origin+"/chat");
  await page.getByLabel("Language / 语言").selectOption(language);
  const panel=page.locator(".local-copilot"),tabs=page.locator(".local-tabs");
  await expect(tabs.getByRole("button",{name:t("Explain","解释含义"),exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(panel.getByRole("heading",{name:t("Explain a picture or emoji","解释图片或 emoji"),exact:true})).toBeVisible();
  await expect(panel.locator(".studio-ai-card,.local-generation,.speaker-profile")).toHaveCount(0);
  await expect(panel.getByRole("button",{name:/Find visual candidates|Start an original visual|Generate|找到视觉回应|创作原创视觉|生成/})).toHaveCount(0);
  for(const width of [320,556]){
    await page.setViewportSize({width,height:950});
    if(!await panel.isVisible())await page.getByRole("button",{name:t("Open AI panel","打开 AI 面板"),exact:true}).click();
    await expect(panel.getByRole("heading",{name:t("Explain a picture or emoji","解释图片或 emoji"),exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:resolve(".local","visual-context",`explain-scope-${language}-${width}.png`)});
  }
  expect(explainInputs).toHaveLength(0);expect(images).toHaveLength(0);expect(sourceRequests).toHaveLength(0);
  await api(page,"message",{speaker:"Maya",text:"Two alternatives were proposed.",attachment:{base64:png.toString("base64"),mime:"image/png",category:"image"}});
  for(let i=1;i<14;i++)await api(page,"message",{speaker:"Alex",text:`Context ${i}`});
  await api(page,"speaker/profile",{speaker:"Maya",profile:{...emptySpeakerProfile(),language:"zh-CN",tone:"Warm but cautious"}});
  await page.setViewportSize({width:1440,height:950});await page.reload();await page.getByLabel("Language / 语言").selectOption(language);
  await expect(panel.locator(".speaker-profile")).toHaveCount(0);
  const processed=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/process");
  await page.getByTestId("chat-message").first().getByRole("button",{name:t("Explain","解释一下"),exact:true}).click();
  const result=(await (await processed).json()).result;
  expect(result.kind).toBe("explanation");
  await expect(panel.locator(".explanation-background")).toContainText(t("The source cannot be identified confidently","无法从所选图片或表情可靠识别出处"));
  await expect(panel.locator(".explanation-brief")).toContainText(t("It may express hesitation","可能是在表达"));
  await expect(panel.locator(".speaker-profile > summary")).toContainText(t("Selected sender profile","所选消息发言者偏好"));
  await expect(panel.locator(".speaker-profile > summary")).toContainText("Maya");
  await expect(panel.locator(".studio-ai-card,.local-generation")).toHaveCount(0);
  await expect(panel.getByText(t("Outgoing speaker profile","当前发言者偏好"),{exact:false})).toHaveCount(0);
  await expect(panel.getByText(t("Two geometric shapes.","两个几何形状。"),{exact:true})).not.toBeVisible();
  await panel.getByText(t("Details","详情"),{exact:true}).click();
  await expect(panel.getByText(t("Two geometric shapes.","两个几何形状。"),{exact:true})).toBeVisible();
  expect(explainInputs).toHaveLength(1);
  expect(explainInputs[0]).toMatchObject({target:{kind:"visual"},speakerContext:{role:"selected-sender",profile:{language:"zh-CN",tone:"Warm but cautious"}}});
  expect(explainInputs[0].context).toHaveLength(10);
  expect(images).toHaveLength(0);expect(sourceRequests).toHaveLength(0);
  await tabs.getByRole("button",{name:t("Express","帮我表达"),exact:true}).click();
  await expect(panel.locator(".speaker-profile > summary")).toContainText(t("Outgoing speaker profile","当前发言者偏好"));
  await expect(panel.locator(".speaker-profile > summary")).toContainText("Alex");
  const intent="A fictional team facing two choices in a playful dilemma.";
  await page.getByLabel(t("What would you like to express?","你想表达什么？"),{exact:true}).fill(intent);
  await page.getByRole("radio",{name:t("Create a new image","生成新图"),exact:true}).check();
  await openCreationOptions(page);await page.getByLabel(t("Expression style","表达风格"),{exact:true}).selectOption("light-comic");
  await tabs.getByRole("button",{name:t("Explain","解释含义"),exact:true}).click();
  await expect(panel.locator(".local-generation,.studio-ai-card")).toHaveCount(0);
  await expect(panel.locator(".explanation-brief")).toHaveCount(0);
  expect(explainInputs).toHaveLength(1);expect(images).toHaveLength(0);expect(sourceRequests).toHaveLength(0);
  await tabs.getByRole("button",{name:t("Express","帮我表达"),exact:true}).click();
  await page.getByRole("radio",{name:t("Create a new image","生成新图"),exact:true}).check();
  await expect(page.getByLabel(t("What would you like to express?","你想表达什么？"),{exact:true})).toHaveValue(intent);
  await openCreationOptions(page);await expect(page.getByLabel(t("Expression style","表达风格"),{exact:true})).toHaveValue("light-comic");
  await expect(panel.locator(".local-generation")).toContainText(t("matched locally against Imgflip","Imgflip 公开热门模板列表中进行本地匹配"));
  expect(sourceRequests).toHaveLength(0);expect(images).toHaveLength(0);
  await page.getByRole("button",{name:t("Generate 3 options","生成 3 个方案"),exact:true}).click();
  await expect(panel.locator(".generation-batch")).toContainText(t("3 of 3 ready","3 个方案中已有 3 个就绪"));
  expect(images).toHaveLength(3);expect(explainInputs).toHaveLength(1);
  expect(sourceRequests).toEqual([{url:"https://api.imgflip.com/get_memes",body:undefined}]);
  for(const body of images){
    const payload=JSON.parse(JSON.parse(body).prompt.split("\n").at(-1)!);
    expect(payload.intent).toBe(intent);expect(payload.expression.style).toBe("light-comic");expect(payload.context).toHaveLength(10);
    expect(payload.publicTextInspiration.references).toHaveLength(1);
    expect(payload.publicTextInspiration.references[0].name).toBe("Two Buttons");
  }
  expect(app.memeCounters.imageRequests).toBe(0);
  await expect(page.getByTestId("chat-message")).toHaveCount(14);
});
