import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import type {createLocalChatServer as Factory} from "../../src/server/local-chat-server";
import type {LocalGenerationDraft,LocalMessage} from "../../src/shared/local-chat";
import {offlineDraft} from "../../src/server/generation.test.support";
import {openCreate} from "../expression-ui";
const root=process.env.VISUAL_BUILD_ROOT??"dist";
test.setTimeout(45_000);
const built=(file:string)=>pathToFileURL(resolve(root,"server",file)).href;
let app:Awaited<ReturnType<typeof Factory>>,origin:string,plans:any[],images:string[],explains:number,external:number,fault:string;
let planCase:"movie"|"game"|"technical"|"meme"|"plain";
let imageGate:Promise<void>|undefined;
const intent="A lighthearted reply agreeing to a small dashboard pilot while keeping the old links";
const realisticReason="The earlier portal joke supports a cautious same-work reply to the dashboard pilot while keeping old links, treating alerts as resolved and remaining understandable because audience familiarity is unknown.";
const caption114="A new dashboard pilot with the old links staying open; one careful step together, not a grand migration overnight.";
test.beforeEach(async()=>{
  plans=[];images=[];explains=0;external=0;fault="";planCase="movie";imageGate=undefined;
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(built("local-chat-server.js"));
  const {ongoingPersonalGenerationOptions}=await import(built("personal-image.js"));
  const {localPaidLease}=await import(built("local-generation-config.js"));
  localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  const generated=await sharp({create:{width:1024,height:1024,channels:3,background:"#587"}}).png().toBuffer();
  const denied=async()=>{external++;throw new Error("Unexpected external request");};
  app=await createLocalChatServer("OFFLINE-FILM-TEST",{
    clientRoot:resolve(root,"client"),interaction:"direct-personal",creationChoices:true,mixedCreation:true,
    webCreation:true,contextualCreation:true,emojiExpressions:true,webProvider:"serpapi",catalogSource:"original-demo",cooldownMs:0,
    webSearchTransport:denied,memeTransport:denied,
    transport:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)),input=JSON.parse(body.messages[1].content[0].text);
      if(input.task==="explain"){
        explains++;
        return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
          background:{source:"The Lord of the Rings",context:"A fictional fellowship facing a difficult shared task",frames:input.frames.map((f:any)=>f.id)},
          observations:[{text:"A fictional wizard",frames:input.frames.map((f:any)=>f.id)}],commonUsage:["A daunting task"],
          contextualInterpretations:[{text:"It may be a playful allusion",context:input.context.map((c:any)=>c.label)}],
          uncertainties:["Source is a model interpretation"],safeResponseGuidance:["Ask when unsure"]
        })}}]});
      }
      expect(input.task).toBe("plan-contextual-expression");plans.push({body,input});
      expect(body.response_format).toMatchObject({type:"json_schema",json_schema:{name:"express_visual_plan_v12",strict:true}});
      const schema=body.response_format.json_schema.schema;
      if(!input.preferences.familiarity)expect(schema.properties.familiarity.enum).toEqual(["unknown"]);
      if(!input.expression?.reference)for(const branch of schema.properties.reference.anyOf){
        if(branch.properties.choice)expect(branch.properties.choice.enum).not.toContain("explicit");
      }
      if(!input.frames.length)expect(schema.properties.appearance.anyOf).toHaveLength(1);
      const original=input.expression?.culturalMode==="original"||input.intent.includes("cats");
      const explicit=!!input.expression?.reference&&(input.expression.culturalMode==="explicit"||input.expression.culturalMode===undefined);
      const cue=input.context.find((c:any)=>c.text.includes("rule them all"));
      const grounded=!original&&(!!cue||input.knownSources?.length>0||input.frames.length>0||explicit);
      const sourceId=explicit?"reference":cue?cue.id:input.knownSources?.length?"k1":input.frames[0]?.id;
      const result:Record<string,unknown>={searchMotif:"none",
        reference:grounded?{kind:"fictional",choice:explicit?"explicit":"same-source",sourceId,
          work:explicit?"Sherlock Holmes":"The Lord of the Rings",characters:{first:explicit?"Sherlock Holmes":"Boromir",second:null}}:{kind:"plain"},
        replyIntent:original?"Celebrate the resolved checks with two cats":"Alerts are fixed; agree to a modest dashboard pilot and keep old links",
        reason:grounded?"A cautious character fits the small pilot; audience familiarity is unknown":"An understandable original scene",
        adaptedCaption:grounded?"One does not simply replace every link":null,
        familiarity:input.preferences.familiarity?"mixed":"unknown",
        observedSources:Object.fromEntries(input.frames.map((frame:{id:string})=>[frame.id,grounded?"The Lord of the Rings":null])),
        subject:original?"cat":"hero",reaction:"relieved",medium:grounded?"movie":"unknown",
        appearance:input.frames.length?{style:"photographic",frameId:input.frames[0].id}:{style:"unknown"},
        motif:grounded?"A cautious fictional warrior gestures toward a small trial":"Two cats resting together",
        subjectCount:original?2:1
      };
      if(planCase!=="movie")Object.assign(result,{
        reference:planCase==="game"?{kind:"fictional",choice:"same-source",sourceId:"c1",work:"Portal",characters:{first:"GLaDOS",second:null}}:
          planCase==="plain"?{kind:"plain"}:{kind:"callback",choice:"same-source",sourceId:"c1",hook:planCase==="technical"?"The deployment train":"This is fine meme"},
        searchMotif:planCase==="technical"?"train":planCase==="meme"?"fire":"none",
        subject:planCase==="game"?"robot":"person",medium:planCase==="game"?"video game":planCase==="meme"?"meme":"unknown",
        appearance:{style:"unknown"},observedSources:{},
        reaction:planCase==="plain"?"supportive":"relieved",replyIntent:input.intent,
        reason:planCase==="plain"?"The latest turn needs serious reassurance, not the earlier joke":"Continue the visible context hook without inventing shared history",
        adaptedCaption:planCase==="plain"?null:"One small step at a time"});
      if(fault==="schema")(result as any).unexpected="PRIVATE_PROVIDER_PAYLOAD";
      const reference=result.reference as Record<string,unknown>;
      if(fault==="evidence")reference.sourceId="not-owned";
      if(fault==="familiarity-evidence")result.familiarity="familiar";
      if(fault==="reference-evidence")reference.sourceId="reference";
      if(fault==="style-evidence")result.appearance={style:"photographic"};
      if(fault==="missing-style-frame")result.appearance={style:"photographic"};
      if(fault==="foreign-style-frame")result.appearance={style:"photographic",frameId:"v99"};
      if(fault==="frame-count")result.observedSources={v99:null};
      if(fault==="reference-mode")reference.choice="explicit";
      if(fault==="forced-callback")result.reference={kind:"callback",choice:"same-source",sourceId:"c1",hook:"An unwanted callback"};
      if(fault==="unknown-style")result.appearance={style:"cinema"};
      if(fault==="reference-array")reference.choice=["original"];
      if(fault==="callback-names")result.reference={kind:"callback",choice:"same-source",sourceId:"c1",hook:"A visible joke",work:"The Lord of the Rings",characters:["Gandalf"]};
      if(fault==="plain-names")result.reference={kind:"plain",work:"The Lord of the Rings",characters:["Gandalf"]};
      if(fault==="derived-mode")result.mode="inherit";
      if(fault==="flat-output"){delete result.reference;Object.assign(result,{kind:"callback",hook:"A visible joke",franchise:"The Lord of the Rings",
        characters:["Gandalf"],mode:"inherit",referenceChoice:"same-source",certainty:"grounded"});}
      if(fault==="familiarity-array")result.familiarity=["familiar"];
      if(fault==="long-reason")result.reason="PRIVATE_PROVIDER_REASON".padEnd(321,"x");
      if(fault==="multi-clause-reason")result.reason=realisticReason;
      if(fault==="caption-114")result.adaptedCaption=caption114;
      if(fault==="caption-500")result.adaptedCaption="x".repeat(500);
      if(fault==="caption-501")result.adaptedCaption="x".repeat(501);
      if(fault==="missing-field")delete result.searchMotif;
      if(fault==="root-array")return Response.json({choices:[{finish_reason:"stop",message:{content:"[]"}}]});
      if(fault==="json")return Response.json({choices:[{finish_reason:"stop",message:{content:"PRIVATE_BAD_JSON"}}]});
      return Response.json({choices:[{finish_reason:fault==="truncated"?"length":"stop",message:{content:JSON.stringify(result)}}]});
    },
    generation:{...ongoingPersonalGenerationOptions(),transport:async(_url,init)=>{
      images.push(String(init?.body));await imageGate;return Response.json({data:[{b64_json:generated.toString("base64")}]});
    }}
  });
  origin=await app.start(0);
});
test.afterEach(async()=>{await app.close();expect(external).toBe(0);});
async function api(page:Page,path:string,body:object={},revision=true){
  return page.evaluate(async({path,body,revision})=>{
    const state=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
    const response=await fetch("/local/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":state.csrf},
      body:JSON.stringify(revision?{revision:state.revision,...body}:body)});
    return {status:response.status,value:await response.json()};
  },{path,body,revision});
}
function draftFor(messages:LocalMessage[]):LocalGenerationDraft{
  return {...offlineDraft(),intent,creative:"",expression:{style:"auto",intensity:"auto",reference:""},
    context:messages.map(m=>({label:m.id,text:`${m.speaker}: ${m.text}`,included:true}))};
}
async function seedText(page:Page){
  await page.goto(origin+"/chat");
  for(const [speaker,text] of [["Alex","One portal for deployments and alerts"],["Maya","One portal to rule them all?"],
    ["Alex","Both alerts are fixed. Let's pilot dashboards; keep old links."]]){
    expect((await api(page,"message",{speaker,text})).status).toBe(200);
  }
  return (await api(page,"state",{},false)).value;
}
test("text-only batch review grounds the film, binds one image, and never sends before manual insertion",async({page})=>{
  const state=await seedText(page),draft=draftFor(state.messages);
  const review=await api(page,"generation/batch/review",{draft,draftRevision:0,count:1,referenceMode:"none"});
  expect(review.status,JSON.stringify(review.value)).toBe(200);
  expect(plans).toHaveLength(1);expect(images).toHaveLength(0);expect(explains).toBe(0);
  expect(plans[0].input.context.at(-1)).toMatchObject({role:"outgoing"});
  expect(plans[0].input.context[1]).toMatchObject({role:"other"});
  expect(plans[0].input.frames).toEqual([]);
  expect(review.value.contextPlan).toMatchObject({franchise:"The Lord of the Rings",characters:["Boromir"],reaction:"relieved",referenceChoice:"same-source"});
  expect(review.value.requests[0].prompt).toContain("keep old links");
  expect(review.value.requests[0].prompt).toContain("not an actual movie frame");
  expect(review.value.requests[0].prompt).toContain("recognizable in the imagery with the caption hidden");
  expect((await api(page,"generation/batch/process",{batchId:review.value.batchId,digest:review.value.digest,attempt:0,consent:true},false)).status).toBe(200);
  await expect.poll(async()=> (await api(page,"generation/batch/status",{batchId:review.value.batchId},false)).value.status).toBe("ready");
  expect(images).toHaveLength(1);
  expect(images[0]).toContain("not removal of the supported source identity");
  expect(images[0]).toContain("Default to NO in-image text or lettering");
  expect(images[0]).toContain("separate editable reply caption displayed beside the image; do NOT draw it into the image by default");
  expect(images[0]).not.toContain("Use contextDirection.adaptedCaption as optional newly written reply text");
  expect((await api(page,"state",{},false)).value.messages).toHaveLength(3);
});
test("the original nine-message demo route plans current intent and reuses a prior owned explanation without a second Explain call",async({page})=>{
  await page.goto(origin+"/chat");
  const seeded=await api(page,"demo",{language:"en",scenario:"combined"});expect(seeded.status).toBe(200);
  const messages=seeded.value.messages as LocalMessage[];expect(messages).toHaveLength(9);
  const input={version:0,intent:"",context:messages.map(m=>({label:m.id,text:`${m.speaker}: ${m.text}`,included:true})),
    preferences:{source:"requester-reported",confirmed:true,outputLanguage:"en",formality:"unknown",familiarity:"",relationship:"",humor:"",avoid:""}};
  const explain=await api(page,"review",{selectedId:messages[1].id,command:"explainVisual",input});expect(explain.status).toBe(200);
  expect((await api(page,"process",{digest:explain.value.processing.digest,consent:true})).status).toBe(200);
  const draft=draftFor(messages);draft.preferences.familiarity="Some know the films, others do not";
  const review=await api(page,"generation/batch/review",{draft,draftRevision:0,count:1,referenceMode:"none"});
  expect(review.status,JSON.stringify(review.value)).toBe(200);
  expect(explains).toBe(1);expect(plans).toHaveLength(1);expect(images).toHaveLength(0);
  expect(plans[0].input.knownSources[0]).toMatchObject({context:"c2",source:"The Lord of the Rings"});
  expect(plans[0].input.frames[0].context).toBe("c2");
  expect(plans[0].input.context.at(-1).text).toContain("Let's pilot dashboards; keep old links");
  expect(plans[0].input.context[6].text).toContain("Both alerts are fixed");
  expect(review.value.contextPlan.familiarity).toBe("mixed");
  expect((await api(page,"edit",{id:messages[1].id,speaker:"Maya",text:"An unrelated picture"})).status).toBe(200);
  const next=await api(page,"generation/batch/review",{draft,draftRevision:1,count:1,referenceMode:"none"});
  expect(next.status,JSON.stringify(next.value)).toBe(200);
  expect(plans[1].input.knownSources).toBeUndefined();
});
test("combined demo has honest distinct times and automatically grounds the full latest thread without Explain or manual reference selection",async({page})=>{
  await page.goto(origin+"/chat");
  const seeded=await api(page,"demo",{language:"en",scenario:"combined"});expect(seeded.status).toBe(200);
  const messages=seeded.value.messages as LocalMessage[];
  expect(messages.map(m=>new Date(m.createdAt!).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})))
    .toEqual(["11:42","11:43","11:44","11:47","11:48","11:49","12:02","12:03","12:04"]);
  expect(messages.every(m=>m.demoTimeline&&!m.generated)).toBe(true);
  await page.reload();await expect(page.locator(".studio-chat-subhead")).toContainText("illustrative times");
  expect(await page.getByTestId("chat-message").locator("time").allTextContents()).toHaveLength(9);
  const draft=draftFor(messages);
  draft.intent="Playfully pick up our earlier joke while agreeing to a small dashboard pilot and keeping the old links.";
  const review=await api(page,"generation/batch/review",{draft,draftRevision:0,count:1,referenceMode:"none"});
  expect(review.status,JSON.stringify(review.value)).toBe(200);
  expect(plans).toHaveLength(1);expect(explains).toBe(0);expect(images).toHaveLength(0);
  expect(plans[0].input.replyTo).toBeNull();expect(plans[0].input.frames[0].context).toBe("c2");
  expect(plans[0].input.context).toHaveLength(9);expect(plans[0].input.context.at(-1).text).toContain("keep old links");
  expect(plans[0].input.preferences.familiarity).toBeUndefined();expect(plans[0].input.preferences.culture).toBeUndefined();
  expect(review.value.contextPlan).toMatchObject({referenceChoice:"same-source",franchise:"The Lord of the Rings",reaction:"relieved"});
  expect(review.value.contextPlan.evidence).toEqual(["c2"]);
  expect(review.value.contextPlan.visualEvidence).toEqual(["v1"]);
  expect(review.value.contextPlan.visualStyle).toBe("photographic");
  const sent=await api(page,"message",{speaker:"Alex",text:"Ordinary current message",createdAt:0,demoTimeline:true});
  expect(sent.status).toBe(200);expect(sent.value.messages.at(-1).demoTimeline).toBeUndefined();
  expect(sent.value.messages.at(-1).createdAt).toBeGreaterThan(Date.now()-10_000);
});
test("three plain text messages and an explicit new photo subject succeed through the actual planner route",async({page})=>{
  const state=await seedText(page),draft=draftFor(state.messages);
  draft.intent="An original photo of two cats celebrating after the checks were fixed";
  draft.expression={style:"natural-photo",intensity:"auto",reference:"",culturalMode:"original"};
  const review=await api(page,"generation/batch/review",{draft,draftRevision:0,count:1,referenceMode:"none"});
  expect(review.status,JSON.stringify(review.value)).toBe(200);
  expect(review.value.contextPlan).toMatchObject({franchise:null,characters:[],subject:"cat",visualStyle:"unknown",referenceChoice:"original"});
  expect(review.value.requests[0].prompt).toContain("photographic scene");
  expect(images).toHaveLength(0);
});
test("a realistic multi-clause reason exceeding the old cap survives actual review unchanged",async({page})=>{
  const state=await seedText(page);fault="multi-clause-reason";
  const review=await api(page,"generation/batch/review",{draft:draftFor(state.messages),draftRevision:0,count:1,referenceMode:"none"});
  expect(realisticReason.length).toBeGreaterThan(160);expect(realisticReason.length).toBeLessThanOrEqual(320);
  expect(review.status,JSON.stringify(review.value)).toBe(200);
  expect(review.value.contextPlan.reason).toBe(realisticReason);
  expect(JSON.parse(review.value.requests[0].prompt.split("\n").at(-1)).contextDirection.reason).toBe(realisticReason);
  expect(plans[0].body.response_format.json_schema.schema.properties.reason.description).toContain("max 320");
  expect(plans).toHaveLength(1);expect(images).toHaveLength(0);
});
for(const culturalMode of ["follow-conversation","original"] as const){
  test(`${culturalMode} ignores inactive reference text even when supplied directly to the API`,async({page})=>{
    const state=await seedText(page),draft=draftFor(state.messages);
    draft.expression={style:"auto",intensity:"auto",reference:"Sherlock Holmes",culturalMode};
    const review=await api(page,"generation/batch/review",{draft,draftRevision:0,count:1,referenceMode:"none"});
    expect(review.status,JSON.stringify(review.value)).toBe(200);
    expect(JSON.stringify(plans[0])).not.toContain("Sherlock Holmes");
    expect(review.value.requests[0].prompt).not.toContain("Sherlock Holmes");
    expect(images).toHaveLength(0);
  });
}
for(const culturalMode of ["explicit",undefined] as const){
  test(`${culturalMode??"legacy active"} permits explicit choice only with an active supplied override`,async({page})=>{
    const state=await seedText(page),draft=draftFor(state.messages);
    draft.expression={style:"auto",intensity:"auto",reference:"Sherlock Holmes",...(culturalMode?{culturalMode}:{})};
    const review=await api(page,"generation/batch/review",{draft,draftRevision:0,count:1,referenceMode:"none"});
    expect(review.status,JSON.stringify(review.value)).toBe(200);
    const schema=plans[0].body.response_format.json_schema.schema;
    expect(schema.properties.reference.anyOf[0].properties.choice.enum).toEqual(["explicit"]);
    expect(schema.$defs.s.enum).toEqual(["reference"]);
    expect(review.value.contextPlan).toMatchObject({referenceChoice:"explicit",mode:"override",evidence:["reference"],characters:["Sherlock Holmes"]});
    expect(images).toHaveLength(0);
  });
}
test("original mode forbids callback branches even with a stale reference and available chat evidence",async({page})=>{
  const state=await seedText(page),draft=draftFor(state.messages);fault="forced-callback";
  draft.expression={style:"auto",intensity:"auto",reference:"Sherlock Holmes",culturalMode:"original"};
  const review=await api(page,"generation/batch/review",{draft,draftRevision:0,count:1,referenceMode:"none"});
  expect(review.status).toBe(400);
  expect(review.value).toMatchObject({planningReason:"schema",planningIssues:[{field:"reference.kind",rule:"enum",actualType:"string"}]});
  expect(images).toHaveLength(0);
});
for(const [failure,reason] of [["schema","schema"],["evidence","schema"],["unknown-style","schema"],["reference-array","schema"],["familiarity-array","schema"],
  ["long-reason","schema"],["missing-field","schema"],["root-array","schema"],["truncated","truncated"],["json","invalid-json"],
  ["familiarity-evidence","evidence"],["reference-evidence","schema"],["style-evidence","schema"],["frame-count","schema"],["reference-mode","schema"],
  ["callback-names","schema"],["plain-names","schema"],["derived-mode","schema"],["flat-output","schema"],["caption-501","schema"]]){
  test(`${failure} surfaces safe diagnostics and stops before any image or search dispatch`,async({page})=>{
    const state=await seedText(page);fault=failure;
    const review=await api(page,"generation/batch/review",{draft:draftFor(state.messages),draftRevision:0,count:1,referenceMode:"none"});
    expect(review.status).toBe(400);
    expect(review.value).toMatchObject({status:"blocked",code:"generation-context-planning",planningReason:reason});
    if(reason==="schema")expect(review.value.planningIssues).toEqual([failure==="schema"?{field:"$",actualType:"object",rule:"unexpected-fields"}:
      failure==="unknown-style"||failure==="style-evidence"?{field:"appearance.style",actualType:"string",rule:"enum"}:
      failure==="evidence"||failure==="reference-evidence"?{field:"reference.sourceId",actualType:"string",rule:"enum"}:
      failure==="reference-mode"?{field:"reference.choice",actualType:"string",rule:"enum"}:
      failure==="frame-count"?{field:"observedSources",actualType:"object",rule:"frame-count"}:
      failure==="reference-array"?{field:"reference.choice",actualType:"array",rule:"type"}:
      failure==="callback-names"||failure==="plain-names"?{field:"reference",actualType:"object",rule:"unexpected-fields"}:
      failure==="derived-mode"?{field:"$",actualType:"object",rule:"unexpected-fields"}:
      failure==="flat-output"?{field:"reference",actualType:"missing",rule:"missing"}:
      failure==="caption-501"?{field:"adaptedCaption",actualType:"string",rule:"length",actualLength:501,limit:500}:
      failure==="familiarity-array"?{field:"familiarity",actualType:"array",rule:"type"}:
      failure==="long-reason"?{field:"reason",actualType:"string",rule:"length",actualLength:321,limit:320}:
      failure==="missing-field"?{field:"searchMotif",actualType:"missing",rule:"missing"}:{field:"$",actualType:"array",rule:"type"}]);
    if(reason==="evidence")expect(review.value.planningIssues).toEqual([
      failure==="familiarity-evidence"?{field:"familiarity",actualType:"string",rule:"audience-report-required"}:
      failure==="frame-count"?{field:"observedSources",actualType:"array",rule:"frame-count"}:
      failure==="reference-mode"?{field:"reference.choice",actualType:"string",rule:"explicit-reference-required"}:
      {field:"evidence",actualType:"array",rule:"available-evidence"}]);
    expect(JSON.stringify(review.value)).not.toContain("PRIVATE");
    expect(plans).toHaveLength(1);expect(images).toHaveLength(0);
  });
}
test("foreign context and forged profile/source fields are rejected before planning",async({page})=>{
  const state=await seedText(page);
  for(const draft of [{...draftFor(state.messages),knownSources:[{source:"Forged"}]},
    {...draftFor(state.messages),visualContextId:"foreign"},
    {...draftFor(state.messages),context:[{label:"foreign",text:"forged",included:true}]}]){
    expect((await api(page,"generation/batch/review",{draft,draftRevision:0,count:1,referenceMode:"none"})).status).toBe(400);
  }
  expect(plans).toHaveLength(0);expect(images).toHaveLength(0);
});
for(const [failure,reason,detail] of [["long-reason","schema","reason: string / length"],["familiarity-evidence","evidence","familiarity: string / audience-report-required"]]){
test(`real UI displays only safe ${reason} field/type/rule diagnostics and makes no image request`,async({page})=>{
  await seedText(page);await page.reload();await page.getByLabel("Language / 语言").selectOption("en");
  await openCreate(page,"en");
  await page.getByLabel("What would you like to express?",{exact:true}).fill(intent);
  await page.getByRole("checkbox",{name:"Include web image search",exact:true}).uncheck();
  await page.getByLabel("Number of options",{exact:true}).selectOption("1");
  fault=failure;
  await page.getByRole("button",{name:"Create 1 option",exact:true}).click();
  const error=page.locator(".local-generation > .local-error");
  await expect(error).toContainText(`Planner diagnostic: ${reason}`);
  await expect(error).toContainText(detail);
  if(failure==="long-reason")await expect(error).toContainText("(321 > 320)");
  await expect(error).not.toContainText("PRIVATE");
  expect(plans).toHaveLength(1);expect(images).toHaveLength(0);
});
}
for(const scenario of [
  {kind:"game" as const,cue:"The cake is a lie — Portal again.",last:"One careful test first.",intent:"Agree to one careful trial"},
  {kind:"technical" as const,cue:"The deployment train is leaving the station.",last:"One small deployment first.",intent:"A lighthearted agreement to one small deployment step"},
  {kind:"meme" as const,cue:"This is fine — the familiar dog meme.",last:"The checks have recovered now.",intent:"Share mild relief, without implying an ongoing emergency"},
  {kind:"plain" as const,cue:"The deployment train has derailed again, ha.",last:"This is serious; a teammate is overwhelmed. Please reassure them.",intent:"Offer calm support without jokes"}
]){
  test(`${scenario.kind} actual review route represents the contextual hook or deliberately plain reply`,async({page})=>{
    planCase=scenario.kind;await page.goto(origin+"/chat");
    await api(page,"message",{speaker:"Maya",text:scenario.cue});
    await api(page,"message",{speaker:"Alex",text:scenario.last});
    const state=(await api(page,"state",{},false)).value,draft=draftFor(state.messages);draft.intent=scenario.intent;
    const review=await api(page,"generation/batch/review",{draft,draftRevision:0,count:1,referenceMode:"none"});
    expect(review.status,JSON.stringify(review.value)).toBe(200);
    const plan=review.value.contextPlan;
    expect(plan.familiarity).toBe("unknown");expect(plans[0].input.preferences.culture).toBeUndefined();
    if(scenario.kind==="game")expect(plan).toMatchObject({kind:"fictional",franchise:"Portal",characters:["GLaDOS"]});
    else if(scenario.kind==="plain")expect(plan).toMatchObject({kind:"none",hook:null,franchise:null,characters:[],referenceChoice:"original",adaptedCaption:null});
    else expect(plan).toMatchObject({kind:"callback",franchise:null,characters:[],referenceChoice:"same-source"});
    expect(JSON.parse(review.value.requests[0].prompt.split("\n").at(-1)).contextDirection.hook).toBe(plan.hook);
    expect(plans).toHaveLength(1);expect(images).toHaveLength(0);expect(external).toBe(0);
  });
}
test("live sync observes peer work without cancelling it and invalidates stale generated previews locally",async({page,context})=>{
  await seedText(page);await page.reload();
  const peer=await context.newPage();await peer.goto(origin+"/chat");
  await expect(peer.getByRole("textbox",{name:"Message",exact:true})).toBeEnabled();
  let peerCancels=0,peerReads=0,localCancels=0;
  peer.on("request",request=>{
    if(/\/local\/(?:cancel|preview\/cancel)$/.test(request.url()))peerCancels++;
    if(request.url().endsWith("/local/state"))peerReads++;
  });
  await openCreate(page,"en");
  await page.getByLabel("What would you like to express?",{exact:true}).fill(intent);
  await page.getByRole("checkbox",{name:"Include web image search",exact:true}).uncheck();
  await page.getByLabel("Number of options",{exact:true}).selectOption("1");
  let release!:()=>void;imageGate=new Promise<void>(resolve=>release=resolve);
  try{
    await page.getByRole("button",{name:"Create 1 option",exact:true}).click();
    await expect.poll(()=>images.length).toBe(1);
    await page.waitForTimeout(3200);
    expect(peerReads).toBeGreaterThan(0);expect(peerCancels).toBe(0);
  }finally{release();}
  await expect(page.locator(".generation-batch > [role=status]")).toHaveText("1 of 1 ready");
  await page.getByRole("button",{name:"Choose this option",exact:true}).click();
  await page.getByRole("button",{name:"Preview generated insertion",exact:true}).click();
  await expect(page.getByRole("region",{name:"Generated insertion preview",exact:true})).toBeVisible();
  page.on("request",request=>{if(/\/local\/(?:cancel|preview\/cancel)$/.test(request.url()))localCancels++;});
  expect((await api(peer,"message",{speaker:"Maya",text:"A peer update invalidates this preview"})).status).toBe(200);
  await expect(page.locator(".local-messages")).toContainText("A peer update invalidates this preview");
  await expect(page.getByRole("region",{name:"Generated insertion preview",exact:true})).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Contextual reply plan",exact:true})).toHaveCount(0);
  await expect(page.getByLabel("What would you like to express?",{exact:true})).toHaveValue(intent);
  expect(localCancels).toBe(0);expect(peerCancels).toBe(0);
  expect(plans).toHaveLength(1);expect(images).toHaveLength(1);expect(explains).toBe(0);
});
for(const language of ["en","zh-CN"]){
  test(`${language} real UI surfaces reference mode/reason/adapted caption and retains manual preview`,async({page})=>{
    await seedText(page);await page.reload();fault="caption-114";
    await page.getByLabel("Language / 语言").selectOption(language);
    await openCreate(page,language);
    const en=language==="en";
    await page.getByLabel(en?"What would you like to express?":"你想表达什么？",{exact:true}).fill(intent);
    const mode=page.getByLabel(en?"Contextual callback":"接梗方式",{exact:true});
    await expect(mode).toHaveValue("follow-conversation");
    await mode.selectOption("explicit");
    await page.getByLabel(en?"Reference override":"指定参考",{exact:true}).fill("Sherlock Holmes");
    await mode.selectOption("follow-conversation");
    await expect(page.getByLabel(en?"Reference override":"指定参考",{exact:true})).toHaveCount(0);
    await mode.selectOption("explicit");
    await expect(page.getByLabel(en?"Reference override":"指定参考",{exact:true})).toHaveValue("");
    await mode.selectOption("follow-conversation");
    await expect(page.getByLabel(en?"Textual reference idea":"文字参考灵感",{exact:true})).toHaveCount(0);
    await page.getByRole("checkbox",{name:en?"Include web image search":"包含全网图片搜索",exact:true}).uncheck();
    await page.getByLabel(en?"Number of options":"方案数量",{exact:true}).selectOption("1");
    expect(plans).toHaveLength(0);
    await page.getByRole("button",{name:en?"Create 1 option":"创建 1 个方案",exact:true}).click();
    await expect(page.locator(".generation-batch > [role=status]")).toHaveText(en?"1 of 1 ready":"1 个方案中已有 1 个就绪");
    await expect(page.locator(".context-match-cue")).toContainText("The Lord of the Rings");
    await expect(page.locator(".context-reference-summary")).toContainText(en?"New adapted caption — not a source quote":"新改编配文 — 并非来源原句");
    await expect(page.locator(".context-reference-summary")).toContainText("Boromir");
    await expect(page.locator(".context-reference-summary")).toContainText("keep old links");
    const planRegion=page.getByRole("region",{name:en?"Contextual reply plan":"上下文回复方案",exact:true});
    await expect(planRegion).toBeVisible();await expect(planRegion).toContainText("The Lord of the Rings");
    await expect(planRegion.getByRole("heading",{name:en?"Contextual reply plan":"上下文回复方案",exact:true})).toBeVisible();
    await expect(planRegion).not.toContainText("gpt-image");
    expect(plans).toHaveLength(1);expect(images).toHaveLength(1);
    expect(plans[0].input.expression.culturalMode).toBe("follow-conversation");
    expect(JSON.stringify(plans[0])+images[0]).not.toContain("Sherlock Holmes");
    expect((await api(page,"state",{},false)).value.messages).toHaveLength(3);
    await page.getByRole("button",{name:en?"Choose this option":"选择此方案",exact:true}).click();
    expect(caption114).toHaveLength(114);
    const captionEditor=page.getByLabel(en?"Local output caption":"本地输出配文",{exact:true});
    await expect(captionEditor).toHaveValue(caption114);
    await expect(captionEditor).toHaveAttribute("maxlength","500");
    await page.getByRole("button",{name:en?"Preview generated insertion":"预览生成内容插入",exact:true}).click();
    await expect(page.getByRole("region",{name:en?"Generated insertion preview":"生成内容插入预览",exact:true})).toContainText(caption114);
    await page.getByLabel(en?"Local output caption":"本地输出配文",{exact:true}).fill("A small pilot; the old links stay.");
    await page.getByRole("button",{name:en?"Choose this option":"选择此方案",exact:true}).click();
    await expect(captionEditor).toHaveValue("A small pilot; the old links stay.");
    await page.getByRole("button",{name:en?"Preview generated insertion":"预览生成内容插入",exact:true}).click();
    await expect(page.getByRole("region",{name:en?"Generated insertion preview":"生成内容插入预览",exact:true})).toBeVisible();
    expect((await api(page,"state",{},false)).value.messages).toHaveLength(3);
  });
}
  test("500-character planner captions survive generation and preview; preview rejects 501 without another dispatch",async({page})=>{
    const state=await seedText(page);fault="caption-500";
    const review=await api(page,"generation/batch/review",{draft:draftFor(state.messages),draftRevision:0,count:1,referenceMode:"none"});
    expect(review.status,JSON.stringify(review.value)).toBe(200);
    expect(review.value.contextPlan.adaptedCaption).toBe("x".repeat(500));
    expect((await api(page,"generation/batch/process",{batchId:review.value.batchId,digest:review.value.digest,attempt:0,consent:true},false)).status).toBe(200);
    await expect.poll(async()=> (await api(page,"generation/batch/status",{batchId:review.value.batchId},false)).value.status).toBe("ready");
    const batch=(await api(page,"generation/batch/status",{batchId:review.value.batchId},false)).value;
    const body={assetId:batch.candidates[0].operation.image.assetId,variant:"image",speaker:"Alex",alt:"An original fictional reaction",caption:"x".repeat(500)};
    const preview=await api(page,"generation/preview",body);
    expect(preview.status,JSON.stringify(preview.value)).toBe(200);expect(preview.value.caption).toBe(body.caption);
    expect((await api(page,"generation/preview",{...body,caption:"x".repeat(501)})).status).toBe(400);
    expect(plans).toHaveLength(1);expect(images).toHaveLength(1);
    expect((await api(page,"state",{},false)).value.messages).toHaveLength(3);
  });
  for(const failure of ["missing-style-frame","foreign-style-frame"]){
    test(`${failure} with an actual owned image is rejected structurally before image dispatch`,async({page})=>{
      await page.goto(origin+"/chat");const seeded=await api(page,"demo",{language:"en",scenario:"combined"});fault=failure;
      const review=await api(page,"generation/batch/review",{draft:draftFor(seeded.value.messages),draftRevision:0,count:1,referenceMode:"none"});
      expect(review.status).toBe(400);
      expect(review.value).toMatchObject({code:"generation-context-planning",planningReason:"schema",planningIssues:[
        {field:"appearance.frameId",rule:failure==="missing-style-frame"?"type":"enum",actualType:failure==="missing-style-frame"?"missing":"string"}]});
      expect(plans).toHaveLength(1);expect(images).toHaveLength(0);
    });
  }
