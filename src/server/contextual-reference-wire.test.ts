import Ajv from "ajv";
import {expect,it} from "vitest";
import sharp from "sharp";
import {buildExpressVisualPlan,validateExpressVisualPlan} from "./express-visual-plan";
import {loadLocalChatConfig} from "./local-chat-config";
import {offlineDraft} from "./generation.test.support";
import {ModelGateway} from "./model-gateway";
import {digest} from "./analysis-session";
import {validPlanningSchemaIssue} from "../shared/local-chat";
import {localOutputCaptionLimit} from "../shared/local-chat";
import {buildCreativeBrief} from "./local-generation";
import {validWebSearchTerms} from "../shared/web-search-terms";
import type {SourceRankingInput} from "./meme-source-ranking";
const ajv=new Ajv({strict:true,allowUnionTypes:true});
const emptyMedia={samples:[],coverage:[]};
const input=():SourceRankingInput=>({draft:{...offlineDraft(),creative:"",
  intent:"Agree to a small pilot while keeping the old links",
  expression:{style:"auto",intensity:"auto",reference:"",culturalMode:"follow-conversation"},
  context:[{label:"m1",included:true,text:"Maya: One portal to rule them all?"},
    {label:"m2",included:true,text:"Alex: Alerts are fixed; pilot dashboards and keep old links."}]}});
const common={replyIntent:"The alerts are resolved; agree to a modest pilot and retain old links",
  reason:"The earlier reference fits a cautious pilot, but audience familiarity is unknown.",
  adaptedCaption:"One small step; the old path stays",familiarity:"unknown",observedSources:{},
  searchMotif:"none",subject:"person",reaction:"relieved",medium:"unknown",appearance:{style:"unknown"},
  motif:"A cautious gesture toward a small trial",subjectCount:1};
const fiction={kind:"fictional",choice:"same-source",sourceId:"c1",work:"The Lord of the Rings",characters:{first:"Boromir",second:null}};
const callback={kind:"callback",choice:"same-source",sourceId:"c1",hook:"The deployment train"};
function setup(draft=input()){
  const config=loadLocalChatConfig("OFFLINE",true);
  const request=buildExpressVisualPlan(draft,emptyMedia,config.profile!,config.executionScope!);
  const schema=JSON.parse(request.body).response_format.json_schema.schema;
  return {draft,config,request,schema,accepts:ajv.compile(schema)};
}
it.each([
  ["film","Maya: One portal to rule them all?",fiction,"fictional","inherit","grounded"],
  ["game","Maya: The cake is a lie, as in Portal.",{...fiction,work:"Portal",characters:{first:"GLaDOS",second:null}},"fictional","inherit","grounded"],
  ["technical metaphor","Maya: The deployment train is boarding.",callback,"callback","inherit","grounded"],
  ["visible wordplay","Maya: Our build is building suspense.",{...callback,hook:"Building suspense"},"callback","inherit","grounded"],
  ["nonfilm meme","Maya: This is fine, like the dog meme.",{...callback,hook:"This is fine"},"callback","inherit","grounded"],
  ["plain serious","Maya: Someone is overwhelmed. No jokes.",{kind:"plain"},"none","unanchored","none"]
] as const)("decodes an actual JSON completion envelope for %s using the strict union",async(_label,text,reference,kind,mode,certainty)=>{
  const draft=input();draft.draft.context[0].text=text;
  const {config,request,schema,accepts}=setup(draft);
  const value={...common,reference,...(kind==="none"?{adaptedCaption:null,reaction:"supportive"}:{})};
  expect(accepts(value),JSON.stringify(accepts.errors)).toBe(true);
  expect(schema.type).toBe("object");expect(schema).not.toHaveProperty("anyOf");
  expect(schema.properties.reference.anyOf).toHaveLength(3);
  expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
  for(const branch of schema.properties.reference.anyOf){
    expect(branch.type).toBe("object");expect(branch.additionalProperties).toBe(false);
    expect(branch.required.sort()).toEqual(Object.keys(branch.properties).sort());
  }
  for(const derived of ["kind","franchise","characters","hook","mode","referenceChoice","certainty","visualStyle"])
    expect(schema.properties).not.toHaveProperty(derived);
  config.localRequestDigests=new Set([request.review.digest]);
  let calls=0;
  const gateway=new ModelGateway(config,async(_url,init)=>{
    calls++;expect(JSON.parse(String(init?.body))).toEqual(JSON.parse(request.body));
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]});
  });
  const plan=validateExpressVisualPlan(await gateway.run(request.body,request.review,new AbortController().signal),draft,request.review);
  expect(plan).toMatchObject({kind,mode,certainty,familiarity:"unknown",reaction:value.reaction});
  expect(plan.referenceChoice).toBe(kind==="none"?"original":"same-source");
  if(kind!=="fictional")expect(plan).toMatchObject({franchise:null,characters:[]});
  if(kind!=="callback")expect(plan.hook).toBeNull();
  expect(request.review.outputReserve).toBe(950);expect(calls).toBe(1);
});
it.each([
  {reference:{...callback,work:"The Lord of the Rings",characters:["Gandalf"]}},
  {reference:{kind:"plain",work:"The Lord of the Rings",characters:["Gandalf"]}},
  {reference:{kind:"plain",hook:"PRIVATE_HOOK"}},
  {reference:{...fiction,hook:"PRIVATE_HOOK"}},
  {reference:{...fiction,choice:"original"}},
  {reference:{...callback,choice:["same-source"]}},
  {reference:{kind:["plain"]}},
  {reference:{kind:"fictional",choice:"same-source",characters:["Gandalf"]}},
  {reference:{...fiction,work:null}},
  {reference:{kind:"PRIVATE_KIND"}},
  {reference:{kind:"plain"},mode:"inherit"},
  {reference:{kind:"plain"},certainty:"grounded"},
  {reference:{kind:"plain"},franchise:"PRIVATE_WORK"},
  {reference:{kind:"plain"},referenceChoice:"same-source"}
])("both wire schema and application reject contradictory or malformed branches: %j",changes=>{
  const {draft,request,accepts}=setup(),value={...common,...changes};
  expect(accepts(value)).toBe(false);
  try{validateExpressVisualPlan(value,draft,request.review);expect.fail("Invalid union must not be repaired");}
  catch(error){
    expect(error).toMatchObject({code:"model-output-invalid-schema"});
    const issues=(error as {issues:unknown[]}).issues;
    expect(issues.length).toBeGreaterThan(0);expect(issues.every(validPlanningSchemaIssue)).toBe(true);
    expect(JSON.stringify(error)).not.toContain("PRIVATE");
  }
});
it("rejects obsolete flat output rather than stripping names or accepting a compatibility fallback",()=>{
  const {draft,request,accepts}=setup();
  const obsolete={...common,kind:"callback",hook:"The deployment train",franchise:"The Lord of the Rings",
    characters:["Gandalf"],mode:"inherit",certainty:"grounded",referenceChoice:"same-source"};
  expect(accepts(obsolete)).toBe(false);
  expect(()=>validateExpressVisualPlan(obsolete,draft,request.review)).toThrow("model-output-invalid-schema");
});
it("constrains original and explicit policy structurally while deriving consistent public modes",()=>{
  const draft=input();draft.draft.expression!.culturalMode="original";
  const original=setup(draft),plain={...common,reference:{kind:"plain"}};
  expect(original.accepts({...common,reference:fiction})).toBe(false);
  expect(original.accepts({...common,reference:callback})).toBe(false);
  expect(original.accepts(plain)).toBe(true);
  expect(validateExpressVisualPlan(plain,draft,original.request.review)).toMatchObject({mode:"override",referenceChoice:"original",kind:"none"});
  draft.draft.expression={style:"auto",intensity:"auto",culturalMode:"explicit",reference:"Sherlock Holmes"};
  const explicit=setup(draft),value={...common,
    reference:{kind:"fictional",choice:"explicit",sourceId:"reference",work:"Sherlock Holmes",characters:{first:"Sherlock Holmes",second:null}}};
  expect(explicit.accepts({...common,reference:fiction})).toBe(false);
  expect(explicit.accepts(value)).toBe(true);
  expect(validateExpressVisualPlan(value,draft,explicit.request.review)).toMatchObject({mode:"override",referenceChoice:"explicit",franchise:"Sherlock Holmes"});
  expect(explicit.accepts(plain)).toBe(true);
});
it("plain serious replies can observe an earlier movie without selecting or leaking it into retrieval",async()=>{
  const draft=input();draft.draft.intent="A serious, calm acknowledgement without a joke.";
  const config=loadLocalChatConfig("OFFLINE",true);
  const bytes=await sharp({create:{width:64,height:64,channels:3,background:"#246"}}).png().toBuffer();
  const media={samples:[{id:"frame",assetId:"m1",digest:digest(bytes),mime:"image/png" as const,width:64,height:64,
    bytes:bytes.length,timestampMs:0,frameIndex:0,dataUrl:`data:image/png;base64,${bytes.toString("base64")}`}],coverage:[]};
  const request=buildExpressVisualPlan(draft,media,config.profile!,config.executionScope!);
  const value={...common,reference:{kind:"plain"},observedSources:{v1:"The Lord of the Rings"},
    appearance:{style:"photographic",frameId:"v1"},reaction:"supportive",adaptedCaption:null};
  expect(ajv.compile(JSON.parse(request.body).response_format.json_schema.schema)(value)).toBe(true);
  const plan=validateExpressVisualPlan(value,draft,request.review);
  expect(plan).toMatchObject({kind:"none",franchise:null,characters:[],hook:null,observedSources:["The Lord of the Rings"],
    evidence:[],visualEvidence:["v1"],visualStyle:"photographic"});
  expect(plan.query).not.toMatch(/movie|meme|Ring|Gandalf/i);
});
it("the union does not weaken evidence checks or silently shorten excessive output",()=>{
  const {draft,request,accepts}=setup();
  const tooLong={...common,reference:fiction,reason:"x".repeat(321)};
  expect(accepts(tooLong)).toBe(true);
  expect(()=>validateExpressVisualPlan(tooLong,draft,request.review)).toThrow("model-output-invalid-schema");
  const noSource={...common,reference:{...fiction,sourceId:"intent"}};
  expect(accepts(noSource)).toBe(false);
  expect(()=>validateExpressVisualPlan(noSource,draft,request.review)).toThrow("model-output-invalid-schema");
  const unknownId={...common,reference:{...fiction,sourceId:"c99"}};
  expect(accepts(unknownId)).toBe(false);
  expect(()=>validateExpressVisualPlan(unknownId,draft,request.review)).toThrow("model-output-invalid-schema");
});
it("preserves 114-character and consumer-boundary captions through the complete wire and generation brief",()=>{
  const {draft,request,schema}=setup();
  const caption="A new dashboard pilot with the old links staying open; one careful step together, not a grand migration overnight.";
  expect(caption).toHaveLength(114);
  expect(localOutputCaptionLimit).toBe(500);
  for(const adaptedCaption of [caption,"x".repeat(localOutputCaptionLimit)]){
    const plan=validateExpressVisualPlan({...common,reference:fiction,adaptedCaption},draft,request.review);
    expect(plan.adaptedCaption).toBe(adaptedCaption);
    const brief=buildCreativeBrief(draft.draft,draft.draft.context.map(c=>({id:c.label})),undefined,{treatment:"natural-photo",contextPlan:plan});
    expect(JSON.parse(brief.prompt.split("\n").at(-1)!).contextDirection.adaptedCaption).toBe(adaptedCaption);
  }
  expect(()=>validateExpressVisualPlan({...common,reference:fiction,adaptedCaption:"x".repeat(501)},draft,request.review))
    .toThrow(expect.objectContaining({issues:[{field:"adaptedCaption",rule:"length",actualType:"string",actualLength:501,limit:500}]}));
  expect(schema.properties.adaptedCaption.description).toContain("1-500 chars, aim <=100");
  expect(request.review.outputReserve).toBe(950);
});
it("preserves complete work names independently of external search-query length and word limits",()=>{
  const {draft,request}=setup();
  const title="Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb";
  expect(title.length).toBeGreaterThan(48);expect(title.split(" ").length).toBeGreaterThan(12);
  for(const work of [title,"A".repeat(200)]){
    const plan=validateExpressVisualPlan({...common,reference:{...fiction,work,characters:{first:null,second:null}}},draft,request.review);
    expect(plan.franchise).toBe(work);expect(validWebSearchTerms(plan.query)).toBe(true);
    expect(plan.query.length).toBeLessThanOrEqual(80);
  }
  for(const work of ["A".repeat(201),"https://private.example/title","PRIVATE_NAME_12345","Untrusted\nTitle"])
    expect(()=>validateExpressVisualPlan({...common,reference:{...fiction,work}},draft,request.review)).toThrow("model-output-invalid-schema");
});
it.each(["replyIntent","hook","motif"] as const)("treats %s brevity as guidance rather than a presentation-sized rejection",field=>{
  const {draft,request}=setup(),value={...common,reference:callback};
  for(const length of [240,500]){
    const plan=validateExpressVisualPlan(field==="hook"?{...value,reference:{...callback,hook:"x".repeat(length)}}:
      {...value,[field]:"x".repeat(length)},draft,request.review);
    expect(plan[field]).toBe("x".repeat(length));
  }
  expect(()=>validateExpressVisualPlan(field==="hook"?{...value,reference:{...callback,hook:"x".repeat(501)}}:
    {...value,[field]:"x".repeat(501)},draft,request.review)).toThrow("model-output-invalid-schema");
});
it("hard-constrains appearance citations and keeps c2 reference grounding separate from v1 style",async()=>{
  const draft=input();draft.draft.context[1].text="Maya: One portal to rule them all?";
  const config=loadLocalChatConfig("OFFLINE",true);
  const bytes=await sharp({create:{width:64,height:64,channels:3,background:"#246"}}).png().toBuffer();
  const media={samples:[{id:"owned-frame",assetId:"m1",digest:digest(bytes),mime:"image/png" as const,width:64,height:64,
    bytes:bytes.length,timestampMs:0,frameIndex:0,dataUrl:`data:image/png;base64,${bytes.toString("base64")}`}],coverage:[]};
  const request=buildExpressVisualPlan(draft,media,config.profile!,config.executionScope!);
  const wireSchema=JSON.parse(request.body).response_format.json_schema.schema,accepts=ajv.compile(wireSchema);
  const value={...common,reference:{...fiction,sourceId:"c2"},observedSources:{v1:null},
    appearance:{style:"photographic",frameId:"v1"}};
  expect(wireSchema.properties.appearance.anyOf[1].properties.frameId.enum).toEqual(["v1"]);
  expect(accepts(value),JSON.stringify(accepts.errors)).toBe(true);
  config.localRequestDigests=new Set([request.review.digest]);
  const gateway=new ModelGateway(config,async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]}));
  const plan=validateExpressVisualPlan(await gateway.run(request.body,request.review,new AbortController().signal),draft,request.review);
  expect(plan).toMatchObject({kind:"fictional",franchise:fiction.work,visualStyle:"photographic",evidence:["c2"],visualEvidence:["v1"]});
  expect(request.review.outputReserve).toBe(950);
  for(const appearance of [{style:"photographic"},{style:"photographic",frameId:"c2"},
    {style:"photographic",frameId:"v99"},{style:"photographic",frameId:["v1"]},{style:"unknown",frameId:"v1"}]){
    expect(accepts({...value,appearance})).toBe(false);
    expect(()=>validateExpressVisualPlan({...value,appearance},draft,request.review)).toThrow("model-output-invalid-schema");
  }
  for(const style of ["photographic","illustrated","rendered"]){
    const styled={...value,appearance:{style,frameId:"v1"}};
    expect(accepts(styled)).toBe(true);
    expect(validateExpressVisualPlan(styled,draft,request.review).visualStyle).toBe(style);
  }
  expect(()=>validateExpressVisualPlan({...value,reference:{...fiction,sourceId:"intent"}},draft,request.review)).toThrow("model-output-invalid-schema");
  expect(()=>validateExpressVisualPlan({...value,reference:{...fiction,sourceId:null}},draft,request.review)).toThrow("model-output-invalid-schema");
  expect(()=>validateExpressVisualPlan({...value,reference:{...fiction,sourceId:"v1"}},draft,request.review)).toThrow("model-output-invalid-references");
  expect(()=>validateExpressVisualPlan({...value,appearance:{style:"unknown"},visualStyle:"photographic"},draft,request.review))
    .toThrow("model-output-invalid-schema");
  const absent=setup(draft),noFrames={...value,observedSources:{}};
  expect(absent.schema.properties.appearance.anyOf).toHaveLength(1);
  expect(absent.accepts(noFrames)).toBe(false);
  expect(()=>validateExpressVisualPlan(noFrames,draft,absent.request.review)).toThrow("model-output-invalid-schema");
  const unknown={...noFrames,appearance:{style:"unknown"}};
  expect(absent.accepts(unknown)).toBe(true);
  expect(validateExpressVisualPlan(unknown,draft,absent.request.review)).toMatchObject({visualStyle:"unknown",visualEvidence:[],evidence:["c2"]});
});
