import {expect,it} from "vitest";
import sharp from "sharp";
import {buildExpressVisualPlan,validateResolvedVisualPlan as validateExpressVisualPlan,validateExpressVisualPlan as validateWirePlan,expressPlanTextLimits} from "./express-visual-plan";
import {buildCreativeBrief} from "./local-generation";
import {buildSourceRanking,validateSourceRanking,type SourceRankingInput} from "./meme-source-ranking";
import {offlineDraft} from "./generation.test.support";
import {loadLocalChatConfig} from "./local-chat-config";
import {digest} from "./analysis-session";
import {PlanningSchemaError,PlanningEvidenceError} from "./visual-errors";
import {validPlanningSchemaIssue} from "../shared/local-chat";
import {ModelGateway,type ModelDiagnostic} from "./model-gateway";
import {emptySpeakerProfile} from "../shared/expression";
const config=loadLocalChatConfig("OFFLINE",true);
const emptyMedia={samples:[],coverage:[]};
const input=(texts:string[]):SourceRankingInput=>({draft:{...offlineDraft(),intent:"Agree to a small, cautious pilot",creative:"",
  expression:{style:"auto",intensity:"auto",reference:""},context:texts.map((text,i)=>({label:`m${i}`,text,included:true}))}});
const output={searchMotif:"none",mode:"inherit",kind:"callback",hook:"The deployment train",franchise:null,characters:[],subject:"object",reaction:"hopeful",
  medium:"unknown",visualStyle:"unknown",motif:"One small carriage moving carefully",subjectCount:1,certainty:"grounded",evidence:["c1"],
  observedSources:[],referenceChoice:"same-source",replyIntent:"Support a small pilot while retaining the old path",
  reason:"Continue the visible train metaphor without implying a shared private joke",adaptedCaption:"One carriage at a time",familiarity:"unknown"};

it.each([
  ["technical metaphor","Maya: The deployment train is leaving the station.","The deployment train"],
  ["visible wordplay","Leo: Our build has finally stopped building suspense.","Building suspense"],
  ["nonfilm meme","Maya: This is fine — the familiar dog-in-a-burning-room meme.","This is fine meme"]
])("represents a grounded %s without inventing a franchise",(scenario,text,hook)=>{
  const draft=input([text,"Alex: One small pilot first; keep the old route."]);
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...output,hook,medium:scenario==="nonfilm meme"?"meme":"unknown"},draft,request.review);
  expect(plan).toMatchObject({kind:"callback",hook,franchise:null,characters:[],referenceChoice:"same-source"});
  const schema=JSON.parse(request.body).response_format.json_schema;
  expect(schema.name).toBe("express_visual_plan_v12");
  expect(schema.schema.required).toContain("reference");
  expect(schema.schema.properties.reference.anyOf[1].properties.kind.enum).toEqual(["callback"]);
  const prompt=buildCreativeBrief(draft.draft,draft.draft.context.map(c=>({id:c.label})),undefined,{treatment:"natural-photo",contextPlan:plan}).prompt;
  expect(JSON.parse(prompt.split("\n").at(-1)!).contextDirection).toMatchObject({kind:"callback",hook,franchise:null,characters:[]});
  expect(prompt).toContain("do not invent a franchise, shared history or hidden inside joke");
  expect(prompt).toContain("recognizable in the imagery with the caption hidden");
  expect(prompt).toContain("Do not replace it with generic office approval");
  expect(prompt).not.toContain("Honor named fictional");expect(prompt).not.toContain("chosen recognizable fictional cast");
  expect(JSON.parse(request.body).messages[0].content).toContain("Suitability FIRST, not movies");
});
it("still permits an evidenced game-world callback as one context-specific choice",()=>{
  const draft=input(["Maya: The cake is a lie — Portal strikes again.","Alex: Let's test only a small part this time."]);
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...output,kind:"fictional",hook:null,franchise:"Portal",characters:["GLaDOS"],subject:"robot",medium:"video game",
    motif:"A fictional testing robot considering a small experiment",adaptedCaption:"One test chamber at a time"},draft,request.review);
  expect(plan).toMatchObject({franchise:"Portal",medium:"video game",characters:["GLaDOS"]});
});
it("a serious supportive latest turn can decline a recognized movie source instead of being forced to reuse it",async()=>{
  const draft=input(["Maya: One portal to rule them all?","Alex: This is serious. Someone is overwhelmed; reassure them without jokes."]);
  draft.draft.intent="Offer plain, calm support. No jokes.";
  draft.draft.preferences.familiarity="The recipient does not know the earlier reference";
  const bytes=await sharp({create:{width:64,height:64,channels:3,background:"#246"}}).png().toBuffer();
  const media={samples:[{id:"frame",assetId:"m0",digest:digest(bytes),mime:"image/png" as const,width:64,height:64,bytes:bytes.length,
    timestampMs:0,frameIndex:0,dataUrl:`data:image/png;base64,${bytes.toString("base64")}`}],coverage:[]};
  const request=buildExpressVisualPlan(draft,media,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...output,mode:"unanchored",kind:"none",hook:null,referenceChoice:"original",reaction:"supportive",
    subject:"person",medium:"photo",visualStyle:"photographic",observedSources:["Gandalf"],evidence:["v1","c2"],certainty:"none",
    replyIntent:"Calm reassurance for an overwhelmed teammate",reason:"The latest request is serious and the recipient does not know the earlier joke",
    adaptedCaption:null,familiarity:"unfamiliar"},draft,request.review);
  expect(plan).toMatchObject({observedSources:["Gandalf"],franchise:null,characters:[],hook:null,referenceChoice:"original",adaptedCaption:null});
  expect(plan.query).not.toMatch(/movie|meme|Gandalf|Ring/i);
  const prompt=buildCreativeBrief(draft.draft,draft.draft.context.map(c=>({id:c.label})),undefined,{treatment:"natural-photo",contextPlan:plan}).prompt;
  expect(prompt).toContain("ordinary context-fitting original reply without forcing a pun");
  expect(prompt).toContain("An ordinary concrete scene is appropriate; do not invent a callback");
  expect(prompt).not.toContain("recognizable in the imagery with the caption hidden");
  expect(prompt).not.toContain("Honor named fictional");expect(prompt).not.toContain("chosen recognizable fictional cast");
  expect(JSON.parse(prompt.split("\n").at(-1)!).contextDirection.reaction).toBe("supportive");
});
it("guides image-level callbacks without confusing source recognition and audience familiarity",()=>{
  const draft=input(["A recognizable fictional allusion","The latest turn welcomes a cautious change"]);
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const body=JSON.parse(request.body),instruction=body.messages[0].content;
  expect(instruction).toContain("Recognize fictional works/cast from allusions+frames");
  expect(instruction).toContain("Recognition != audience familiarity");
  expect(instruction).toContain("unknown audience needs clarity, not erased identity");
  expect(instruction).toContain("Confident fitting work=>fictional, even workplace jokes");
  expect(instruction).toContain("callback=nonfiction");
  expect(instruction).toContain("source NAME or null, never descriptions");
  expect(instruction).toContain("concrete subjects+gesture+props carrying the hook without caption");
  expect(instruction).toContain("Queue joke=>tangled queue");
  expect(instruction).toContain("Plain if serious/unfit/opted out");
  expect(instruction).toContain("NEVER identify real people/actors by face");
  expect(instruction).not.toMatch(/Lord of the Rings|Gandalf|Boromir|dashboard|portal/i);
  expect(body.response_format.json_schema.name).toBe("express_visual_plan_v12");
  expect(request.review.outputReserve).toBe(950);
});
it.each(["none","intent","creative"] as const)("separates the editable caption from image lettering (%s request)",field=>{
  const draft=input(["An earlier joke with quoted words"]),request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const caption="A separate reply caption, not lettering for the picture";
  const plan=validateExpressVisualPlan({...output,adaptedCaption:caption},draft,request.review);
  if(field!=="none")draft.draft[field]='Show the words "READY TO TRY" on a small sign inside the image.';
  const brief=buildCreativeBrief(draft.draft,[{id:"m0"}],undefined,{treatment:"natural-photo",contextPlan:plan});
  expect(brief.prompt).toContain("Default to NO in-image text or lettering");
  expect(brief.prompt).toContain("only when the user's current intent or creative explicitly requests text inside the image");
  expect(brief.prompt).toContain("use only the exact requested words");
  expect(brief.prompt).toContain("are NOT requests for in-image lettering");
  expect(brief.prompt).toContain("separate editable reply caption displayed beside the image; do NOT draw it into the image by default");
  expect(brief.prompt).not.toContain("Use contextDirection.adaptedCaption as optional newly written reply text");
  const payload=JSON.parse(brief.prompt.split("\n").at(-1)!);
  expect(payload.contextDirection.adaptedCaption).toBe(caption);
  if(field!=="none")expect(payload[field]).toBe(draft.draft[field]);
});
it("no visible hook and unknown culture produces a valid plain reply without invented familiarity",()=>{
  const draft=input(["Maya 👩🏽‍💻: The check is complete.","Alex: Thanks for helping."]);
  draft.draft.intent="A quiet acknowledgement";
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...output,kind:"none",hook:null,mode:"unanchored",referenceChoice:"original",certainty:"none",
    evidence:["c2"],reaction:"neutral",adaptedCaption:null,replyIntent:"Quietly acknowledge the help",reason:"An ordinary reply fits; no joke is needed"},draft,request.review);
  expect(plan.familiarity).toBe("unknown");
  const payload=JSON.parse(JSON.parse(request.body).messages[1].content[0].text);
  expect(payload.preferences.culture).toBeUndefined();expect(payload.speaker).toBeUndefined();
  expect(()=>validateExpressVisualPlan({...output,familiarity:"familiar"},draft,request.review)).toThrow();
});
it("callback evidence stays strict, and explicit original or subject/style choices are not overridden",()=>{
  const draft=input(["The deployment train is boarding."]),request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  for(const bad of [{...output,evidence:["c99"]},{...output,evidence:["intent"]},{...output,hook:null},
    {...output,franchise:"Invented Film"},{...output,kind:"none"},{...output,hook:"x".repeat(501)}]){
    expect(()=>validateExpressVisualPlan(bad,draft,request.review)).toThrow();
  }
  draft.draft.expression={style:"light-comic",intensity:"auto",reference:"",culturalMode:"original"};
  expect(()=>validateExpressVisualPlan(output,draft,request.review)).toThrow();
  draft.draft.expression={style:"light-comic",intensity:"auto",reference:"deployment train",culturalMode:"explicit"};
  const explicit=validateExpressVisualPlan({...output,mode:"override",referenceChoice:"explicit",evidence:["reference"]},draft,request.review);
  const prompt=buildCreativeBrief(draft.draft,[{id:"m0"}],undefined,{treatment:"natural-photo",contextPlan:explicit}).prompt;
  expect(JSON.parse(prompt.split("\n").at(-1)!).styleDirection).toContain("single-panel reaction comic");
});
it("keeps a private technical hook out of external queries and requires an actual hook match in retrieval",()=>{
  const draft=input(["PRIVATE_PROJECT_771 at https://internal.example: our release train has one carriage."]);
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...output,searchMotif:"train",hook:"PRIVATE_PROJECT_771 release train"},draft,request.review);
  expect(plan.query).not.toMatch(/PRIVATE|771|release train|internal|https|meme/);
  expect(plan.query).toContain("train");
  expect(()=>validateExpressVisualPlan({...output,searchMotif:"PRIVATE_PROJECT_771"},draft,request.review)).toThrow("model-output-invalid-schema");
  const templates=[{id:"a",name:"Supportive reaction",url:"https://example.com/a",width:1,height:1,box_count:1}];
  const rank=buildSourceRanking({...draft,contextPlan:plan},templates,config.profile!,config.executionScope!,true);
  expect(rank.body).toContain("CURRENT reply intent and tone first");
  expect(validateSourceRanking({id:"a",reason:"No proven hook match",kind:"reaction-meme",anchorMatch:"not-required",reactionMatch:true},templates,plan)).toBeUndefined();
  const plainPlan=validateExpressVisualPlan({...output,kind:"none",hook:null,mode:"unanchored",referenceChoice:"original",certainty:"none",adaptedCaption:null},draft,request.review);
  expect(validateSourceRanking({id:"a",reason:"A fitting ordinary visual",kind:"requested-visual",anchorMatch:"not-required",reactionMatch:true},templates,plainPlan)?.id).toBe("a");
  expect(plainPlan.query).not.toContain("meme");
  for(const malformed of [{kind:["reaction-meme"],anchorMatch:"matched"},{kind:"reaction-meme",anchorMatch:["matched"]}])
    expect(()=>validateSourceRanking({id:"a",reason:"Invalid types",reactionMatch:true,...malformed},templates,plan)).toThrow("model-output-invalid-schema");
});
it.each(["referenceChoice","familiarity","mode","kind","certainty","subject","reaction","medium","visualStyle","searchMotif"] as const)(
  "rejects non-string %s enum values rather than coercing arrays or objects",field=>{
    const draft=input(["Our deployment train is boarding."]),request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
    for(const malformed of [[output[field]],{},null,1])
      expect(()=>validateExpressVisualPlan({...output,[field]:malformed},draft,request.review)).toThrow("model-output-invalid-schema");
  });
it.each(["follow-conversation","original"] as const)("deactivates stale references in %s across planning, evidence and image prompts",culturalMode=>{
  const draft=input(["One careful step."]);draft.draft.expression={style:"auto",intensity:"auto",reference:"Sherlock Holmes",culturalMode};
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  expect(request.body).not.toContain("Sherlock Holmes");
  const override={...output,kind:"fictional",mode:"override",referenceChoice:"explicit",hook:null,characters:["Sherlock Holmes"],evidence:["reference"]};
  expect(()=>validateExpressVisualPlan(override,draft,request.review)).toThrow("model-output-invalid-references");
  expect(()=>validateExpressVisualPlan({...override,evidence:["intent"]},draft,request.review)).toThrow("model-output-invalid-references");
  const brief=buildCreativeBrief(draft.draft,[{id:"m0"}]);
  expect(brief.draft.expression?.reference).toBe("");expect(brief.prompt).not.toContain("Sherlock Holmes");
  expect(draft.draft.expression.reference).toBe("Sherlock Holmes");
});
it("preserves deliberately mode-omitted legacy references and explicit overrides",()=>{
  for(const culturalMode of [undefined,"explicit"] as const){
    const draft=input(["One careful step."]);draft.draft.expression={style:"auto",intensity:"auto",reference:"Sherlock Holmes",...(culturalMode?{culturalMode}:{})};
    const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
    expect(request.body).toContain("Sherlock Holmes");
    const plan=validateExpressVisualPlan({...output,kind:"fictional",mode:"override",referenceChoice:"explicit",hook:null,characters:["Sherlock Holmes"],evidence:["reference"]},draft,request.review);
    expect(plan.characters).toEqual(["Sherlock Holmes"]);
    expect(buildCreativeBrief(draft.draft,[{id:"m0"}]).prompt).toContain("Sherlock Holmes");
  }
});
it("rejects malformed requester option enums before any model dispatch",()=>{
  for(const expression of [{style:["auto"],intensity:"auto",reference:""},
    {style:"auto",intensity:["auto"],reference:""},{style:"auto",intensity:"auto",reference:"",culturalMode:["original"]}]){
    expect(()=>buildCreativeBrief({...offlineDraft(),expression},[])).toThrow("generation-invalid-draft");
  }
});
it("allows a related non-fictional callback only with actual context evidence",()=>{
  const draft=input(["The release train is moving."]),request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  expect(validateExpressVisualPlan({...output,referenceChoice:"related",searchMotif:"train"},draft,request.review)).toMatchObject({
    kind:"callback",franchise:null,characters:[],referenceChoice:"related",searchMotif:"train"});
});
it.each([
  ["reason","PRIVATE_REASON_".repeat(30),"length","string"],
  ["replyIntent","x".repeat(501),"length","string"],
  ["adaptedCaption","x".repeat(501),"length","string"],
  ["motif","x".repeat(501),"length","string"],
  ["referenceChoice",["original"],"type","array"],
  ["reaction","PRIVATE_UNKNOWN_ENUM","enum","string"],
  ["subjectCount",7,"range","number"],
  ["characters",["PRIVATE_NAME_12345"],"items","array"]
] as const)("exposes only safe shape diagnostics for %s", (field,value,rule,actualType)=>{
  const draft=input(["One careful step."]),request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  try{validateExpressVisualPlan({...output,[field]:value},draft,request.review);expect.fail("Must reject invalid plan");}
  catch(error){
    expect(error).toBeInstanceOf(PlanningSchemaError);
    expect(error).toMatchObject({issues:[{field,rule,actualType}]});
    expect(JSON.stringify(error)).not.toContain("PRIVATE");
    expect((error as PlanningSchemaError).issues.every(validPlanningSchemaIssue)).toBe(true);
  }
});
it("reports known missing fields without echoing unknown keys or provider output",()=>{
  const draft=input(["One careful step."]),request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const missing:Record<string,unknown>={...output};delete missing.searchMotif;
  for(const [value,issue] of [
    [missing,{field:"searchMotif",rule:"missing",actualType:"missing"}],
    [{...output,PRIVATE_FIELD_NAME:"PRIVATE_TEXT"},{field:"$",rule:"unexpected-fields",actualType:"object"}],
    [[],{field:"$",rule:"type",actualType:"array"}]
  ] as const){
    try{validateExpressVisualPlan(value,draft,request.review);expect.fail("Must reject invalid shape");}
    catch(error){expect(error).toMatchObject({issues:[issue]});expect(JSON.stringify(error)).not.toContain("PRIVATE");}
  }
});
it.each(["valid","length","root"] as const)("preserves the strict v12 wire protocol and diagnoses %s output after the real gateway decoder",async scenario=>{
  const draft=input(["One careful step."]),local=loadLocalChatConfig("OFFLINE",true);
  const request=buildExpressVisualPlan(draft,emptyMedia,local.profile!,local.executionScope!);
  local.localRequestDigests=new Set([request.review.digest]);
  const diagnostics:ModelDiagnostic[]=[];let calls=0;
  const gateway=new ModelGateway(local,async(_url,init)=>{
    calls++;const wire=JSON.parse(String(init?.body));
    expect(wire).toEqual(JSON.parse(request.body));
    expect(wire.response_format).toMatchObject({type:"json_schema",json_schema:{name:"express_visual_plan_v12",strict:true,schema:{additionalProperties:false}}});
    expect(wire.response_format.json_schema.schema.required.sort()).toEqual(Object.keys(wire.response_format.json_schema.schema.properties).sort());
    const {kind,mode,certainty,hook,franchise,characters,referenceChoice,visualStyle,evidence,observedSources,...common}=output;
    const value=scenario==="root"?[]:{...common,reference:{kind:"callback",choice:"same-source",sourceId:"c1",hook},
      observedSources:{},appearance:{style:"unknown"},
      ...(scenario==="length"?{reason:"PRIVATE_PROVIDER_TEXT".repeat(30)}:{})};
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]});
  },event=>diagnostics.push(event));
  const run=async()=>validateWirePlan(await gateway.run(request.body,request.review,new AbortController().signal),draft,request.review);
  if(scenario==="valid")expect(await run()).toMatchObject({kind:"callback",franchise:null});
  else await expect(run()).rejects.toMatchObject({code:"model-output-invalid-schema",issues:[scenario==="root"
    ?{field:"$",actualType:"array",rule:"type"}:{field:"reason",actualType:"string",rule:"length"}]});
  expect(calls).toBe(1);expect(diagnostics[0]).toMatchObject({httpStatus:200,finishReason:"stop",responseFormat:"json_schema"});
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE");
});
it("constrains trusted input facts in the wire schema without inferring recipient familiarity or a source",()=>{
  const draft=input(["Maya: A visible train metaphor."]);
  draft.speakerContext={role:"outgoing-speaker",source:"voluntary-local-report",profile:{...emptySpeakerProfile(),familiarity:"I know the reference"}};
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const schema=JSON.parse(request.body).response_format.json_schema.schema;
  expect(schema.properties.familiarity.enum).toEqual(["unknown"]);
  expect(schema.$defs.s.enum).toEqual(["c1"]);
  expect(schema.properties.appearance.anyOf).toHaveLength(1);
  expect(schema.properties.appearance.anyOf[0].properties.style.enum).toEqual(["unknown"]);
  expect(schema.properties.observedSources).toEqual({type:"object",required:[],additionalProperties:false,properties:{}});
  expect(schema.properties.subjectCount.enum).toEqual([null,1,2,3,4,5,6]);
  expect(schema.properties.reference.anyOf[0].properties.work).not.toHaveProperty("enum");
  expect(schema.$defs.n).toMatchObject({type:["string","null"]});
  expect(JSON.stringify(schema)).not.toMatch(/"maxLength"|"maxItems"|"minimum"|"maximum"|"pattern"/);
  draft.draft.preferences.familiarity="Some recipients know it, some do not";
  draft.draft.expression={style:"auto",intensity:"auto",reference:"A public reference",culturalMode:"explicit"};
  const explicit=JSON.parse(buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!).body).response_format.json_schema.schema;
  expect(explicit.properties.familiarity.enum).toContain("mixed");
  expect(explicit.properties.reference.anyOf[0].properties.choice.enum).toEqual(["explicit"]);
  expect(explicit.properties.reference.anyOf[1].properties.choice.enum).toEqual(["explicit"]);
  expect(explicit.$defs.s.enum).toEqual(["reference"]);
  draft.draft.expression.culturalMode="original";
  const original=JSON.parse(buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!).body).response_format.json_schema.schema;
  expect(original.properties.reference.anyOf).toEqual([{type:"object",additionalProperties:false,required:["kind"],
    properties:{kind:{type:"string",enum:["plain"]}}}]);
  expect(original.properties).not.toHaveProperty("evidence");
});
it("communicates every downstream free-text bound in the actual outgoing schema",()=>{
  const draft=input(["A visible train metaphor."]),request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const body=JSON.parse(request.body),properties=body.response_format.json_schema.schema.properties;
  const fictional=properties.reference.anyOf[0].properties,callback=properties.reference.anyOf[1].properties;
  expect(expressPlanTextLimits).toEqual({replyIntent:500,reason:320,hook:500,motif:500,adaptedCaption:500,name:200});
  for(const [field,limit] of Object.entries(expressPlanTextLimits).filter(([field])=>field!=="name")){
    const property=field==="hook"?callback.hook:properties[field];
    expect(property.description).toContain(String(limit));
    expect(property.description).toContain("chars");
    expect(property.description).toMatch(/single line/i);
  }
  for(const property of [fictional.work,body.response_format.json_schema.schema.$defs.n]){
    expect(property.description).toContain("1-200 chars");
    expect(property.description).not.toContain("max 12 words");expect(property.description).toContain("Trimmed");
  }
  expect(fictional.characters.required).toEqual(["first","second"]);
  expect(properties.reason.description).toContain("One short sentence");
  expect(properties.reason.description).toContain("nonempty");
  expect(properties.reason.description).toContain("Aim <=200");
  expect(body.messages[0].content).toContain("never exceed 320");
  expect(body.messages[0].content).toContain("Bounds count spaces");
  expect(body.messages[0].content).toContain("aim <=100 chars");
  expect(properties.adaptedCaption.description).toContain("aim <=100");
  expect(request.review.outputReserve).toBe(950);
  expect(body[config.profile!.completionField]).toBe(950);
});
it("accepts a realistic multi-clause reason beyond the old cap unchanged, but rejects beyond the new hard cap",()=>{
  const draft=input(["Maya: The deployment train is boarding.","Alex: The alerts are fixed; let's pilot dashboards and keep the old links."]);
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const reason="The earlier train metaphor fits a cautious dashboard pilot while keeping the old links and treating the alerts as resolved, but the reply should stand on its own because audience familiarity with the earlier joke is unknown.";
  expect(reason.length).toBeGreaterThan(160);expect(reason.length).toBeLessThanOrEqual(320);
  expect(validateExpressVisualPlan({...output,reason},draft,request.review).reason).toBe(reason);
  expect(validateExpressVisualPlan({...output,reason:"x".repeat(320)},draft,request.review).reason).toHaveLength(320);
  try{validateExpressVisualPlan({...output,reason:"x".repeat(321)},draft,request.review);expect.fail("Must reject excessive reason");}
  catch(error){expect(error).toMatchObject({issues:[{field:"reason",actualType:"string",rule:"length",actualLength:321,limit:320}]});}
  for(const reason of ["","   "]){
    try{validateExpressVisualPlan({...output,reason},draft,request.review);expect.fail("Must reject empty reason");}
    catch(error){
      expect((error as PlanningSchemaError).issues).toEqual([{field:"reason",actualType:"string",rule:"empty"}]);
    }
  }
});
it("saves only redundant speaker metadata while preserving reviewed text and trusted roles",()=>{
  const draft=input(["Maya: The train is boarding.","Edited reviewed text without a speaker prefix."]);
  draft.contextRoles=[{label:"m0",speaker:"Maya",role:"other"},{label:"m1",speaker:"Alex",role:"outgoing"}];
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const payload=JSON.parse(JSON.parse(request.body).messages[1].content[0].text);
  expect(payload.context).toEqual([{id:"c1",text:draft.draft.context[0].text,role:"other"},
    {id:"c2",text:draft.draft.context[1].text,role:"outgoing",speaker:"Alex"}]);
});
it.each([
  [{familiarity:"familiar"},"familiarity","audience-report-required"],
  [{observedSources:[null]},"observedSources","frame-count"],
  [{evidence:["c1","c1"]},"evidence","unique-evidence"],
  [{evidence:["reference"]},"evidence","available-evidence"],
  [{evidence:["PRIVATE_FOREIGN_ID"]},"evidence","available-evidence"],
  [{visualStyle:"photographic"},"visualStyle","frame-evidence-required"],
  [{hook:null},"hook","hook-kind"],
  [{certainty:"uncertain"},"certainty","grounded-required"],
  [{evidence:[]},"evidence","source-evidence-required"],
  [{mode:"override"},"mode","explicit-reference-required"],
  [{franchise:"Invented Film"},"kind","nonfictional-names"],
  [{referenceChoice:"original"},"referenceChoice","reference-choice"],
  [{mode:"unanchored"},"referenceChoice","reference-mode"],
  [{kind:"fictional",hook:null},"kind","fictional-name-required"],
] as const)("diagnoses semantic evidence rejection without emitting model values: %j",(changes,field,rule)=>{
  const draft=input(["One careful step."]),request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  try{validateExpressVisualPlan({...output,...changes},draft,request.review);expect.fail("Must reject invalid evidence");}
  catch(error){
    expect(error).toBeInstanceOf(PlanningEvidenceError);
    expect(error).toMatchObject({issues:[{field,rule}]});
    expect((error as PlanningEvidenceError).issues.every(validPlanningSchemaIssue)).toBe(true);
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE|Invented Film/);
  }
});
