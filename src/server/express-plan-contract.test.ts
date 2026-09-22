import Ajv from "ajv";
import {beforeAll,expect,it} from "vitest";
import sharp from "sharp";
import {buildExpressVisualPlan,validateExpressVisualPlan} from "./express-visual-plan";
import {loadLocalChatConfig} from "./local-chat-config";
import {offlineDraft} from "./generation.test.support";
import {digest} from "./analysis-session";
import {validWebSearchTerms} from "../shared/web-search-terms";
import type {ExpressionOptions} from "../shared/expression";
import type {SourceRankingInput} from "./meme-source-ranking";
import type {MediaPreview} from "../shared/types";

const ajv=new Ajv({strict:true,allowUnionTypes:true});
const config=loadLocalChatConfig("OFFLINE",true);
let image:MediaPreview["samples"][number];
beforeAll(async()=>{
  const bytes=await sharp({create:{width:64,height:64,channels:3,background:"#456"}}).png().toBuffer();
  image={id:"owned",assetId:"m1",digest:digest(bytes),mime:"image/png",width:64,height:64,
    bytes:bytes.length,timestampMs:0,frameIndex:0,dataUrl:`data:image/png;base64,${bytes.toString("base64")}`};
});
function makeInput(mode:ExpressionOptions["culturalMode"]="follow-conversation",reference="",context=true):SourceRankingInput{
  return {draft:{...offlineDraft(),intent:"A reply about Known Work",creative:"",
    expression:{style:"auto",intensity:"auto",reference,...(mode?{culturalMode:mode}:{})},
    context:context?[{label:"m1",text:"Maya: Known Work is our visible reference.",included:true},
      {label:"m2",text:"Alex: The issue is resolved; try a small pilot.",included:true}]:[]}};
}
function setup(input=makeInput(),frames=0){
  const media={samples:Array.from({length:frames},(_,i)=>({...image,assetId:`m${i+1}`})),coverage:[]};
  const request=buildExpressVisualPlan(input,media,config.profile!,config.executionScope!);
  const schema=JSON.parse(request.body).response_format.json_schema.schema;
  const value={replyIntent:"A small pilot after resolution",reason:"Continue only the fitting reference.",adaptedCaption:null,
    familiarity:"unknown",observedSources:Object.fromEntries(request.review.media.samples.map(frame=>[frame.id,"Known Work"])),
    searchMotif:"none",subject:"person",reaction:"relieved",medium:"unknown",motif:"A cautious original reaction",subjectCount:1,
    appearance:{style:"unknown"},reference:{kind:"plain"}};
  return {input,request,schema,value,accepts:ajv.compile(schema)};
}
const modes=[
  ["follow","follow-conversation","",false],
  ["follow with stale override","follow-conversation","Known Work",false],
  ["original","original","Known Work",false],
  ["explicit","explicit","Known Work",true],
  ["explicit empty","explicit"," ",false],
  ["legacy empty",undefined,"",false],
  ["legacy active",undefined,"Known Work",true]
] as const;
it.each(modes)("audits actual mode/availability schema: %s",(_label,mode,reference,active)=>{
  for(const hasContext of [false,true])for(const frameCount of hasContext?[0,1,2]:[0]){
    const input=makeInput(mode,reference,hasContext);
    if(mode===undefined)delete input.draft.expression!.culturalMode;
    const {schema,value,request,accepts}=setup(input,frameCount);
    const enabled=mode!=="original"&&(mode!=="explicit"||active)&&(active||hasContext);
    const branches=schema.properties.reference.anyOf;
    expect(branches.map((branch:{properties:{kind:{enum:string[]}}})=>branch.properties.kind.enum[0]))
      .toEqual(enabled?["fictional","callback","plain"]:["plain"]);
    expect(accepts(value)).toBe(true);
    expect(validateExpressVisualPlan(value,input,request.review)).toMatchObject({kind:"none",referenceChoice:"original",evidence:[]});
    const choices=active?["explicit"]:["same-source","related"];
    if(enabled)for(const branch of branches.slice(0,2)){
      expect(branch.properties.choice.enum).toEqual(choices);
      expect(schema.$defs.s.enum).toEqual(active?["reference"]:
        [...request.review.media.samples.map(frame=>frame.id),"c1","c2"]);
    }
    for(const kind of ["fictional","callback"])for(const choice of ["same-source","related","explicit"]){
      const ref={kind,choice,sourceId:active?"reference":"c1",...(kind==="fictional"
        ?{work:"Known Work",characters:{first:null,second:null}}:{hook:"Known Work"})};
      const candidate={...value,reference:ref},valid=enabled&&choices.includes(choice);
      expect(accepts(candidate),`${_label}/${hasContext}/${frameCount}/${kind}/${choice}`).toBe(valid);
      if(valid)expect(validateExpressVisualPlan(candidate,input,request.review).referenceChoice).toBe(choice);
      else expect(()=>validateExpressVisualPlan(candidate,input,request.review)).toThrow("model-output-invalid-schema");
    }
    expect(request.review.outputReserve).toBe(950);
  }
});
it("scopes citations to supplied context, cached explanations and retained frames; excludes intent-only identity claims",()=>{
  const input=makeInput();
  input.draft.context.push({label:"excluded",text:"Private excluded reference",included:false});
  input.knownSources=[{label:"m1",source:"Known Work",context:"A reported source"},
    {label:"excluded",source:"Excluded Work",context:"Not reviewed"}];
  const {schema,value,request,accepts}=setup(input,1);
  expect(schema.$defs.s.enum).toEqual(["v1","c1","c2","k1"]);
  const ref={kind:"fictional",choice:"same-source",work:"Known Work",characters:{first:null,second:null}};
  for(const sourceId of ["v1","c1","c2","k1"]){
    const candidate={...value,reference:{...ref,sourceId}};
    expect(accepts(candidate)).toBe(true);
    expect(validateExpressVisualPlan(candidate,input,request.review).evidence).toEqual([sourceId]);
  }
  for(const sourceId of [null,[],"","intent","reference","v2","c3","k2"]){
    const candidate={...value,reference:{...ref,sourceId}};
    expect(accepts(candidate)).toBe(false);
    expect(()=>validateExpressVisualPlan(candidate,input,request.review)).toThrow("model-output-invalid-schema");
  }
});
it("hard-bounds cast slots, observation keys, scalar evidence and every object shape",()=>{
  const {input,schema,value,request,accepts}=setup(makeInput(),2);
  const reference={kind:"fictional",choice:"same-source",sourceId:"c1",work:"Known Work",characters:{first:"Hero",second:"Companion"}};
  const valid={...value,reference};
  expect(accepts(valid)).toBe(true);
  expect(validateExpressVisualPlan(valid,input,request.review)).toMatchObject({characters:["Hero","Companion"],
    observedSources:request.review.media.samples.map(()=>"Known Work"),evidence:["c1"]});
  for(const change of [
    {reference:{...reference,characters:[]}},
    {reference:{...reference,characters:{first:null}}},
    {reference:{...reference,characters:{first:null,second:null,third:"Unexpected"}}},
    {reference:{...reference,characters:{first:[],second:null}}},
    {observedSources:[]},{observedSources:{}},{observedSources:{v1:null,v2:null,v3:null}},
    {observedSources:{v1:[],v2:null}},
    {reference:{...reference,sourceId:["c1","c1"]}},
    {evidence:["c1","c1"]},{visualEvidence:["v1"]},{mode:"inherit"},{certainty:"grounded"},{query:"Injected query"},
    {reference:{...reference,choice:["same-source"]}},
    {subjectCount:7},{subjectCount:1.5},{subjectCount:"1"},
    {appearance:{style:"photographic"}},{appearance:{style:"photographic",frameId:"c1"}},
    {appearance:{style:"unknown",frameId:"v1"}},
    {reference:{kind:"plain",sourceId:"c1"}},{reference:{kind:"plain",hook:"Not plain"}}
  ]){
    const candidate={...valid,...change};
    expect(accepts(candidate),JSON.stringify(change)).toBe(false);
    expect(()=>validateExpressVisualPlan(candidate,input,request.review)).toThrow();
  }
  for(const key of Object.keys(schema.properties)){
    const missing:Record<string,unknown>={...valid};delete missing[key];
    expect(accepts(missing)).toBe(false);
    expect(()=>validateExpressVisualPlan(missing,input,request.review)).toThrow("model-output-invalid-schema");
    const malformed={...valid,[key]:[]};
    expect(accepts(malformed)).toBe(false);
    expect(()=>validateExpressVisualPlan(malformed,input,request.review)).toThrow();
  }
  const noFrames=setup();
  for(const observedSources of [{"":null},{"v1,v2":null},{v1:null}]){
    const candidate={...noFrames.value,observedSources};
    expect(noFrames.accepts(candidate)).toBe(false);
    expect(()=>validateExpressVisualPlan(candidate,noFrames.input,noFrames.request.review)).toThrow("model-output-invalid-schema");
  }
});
it("constrains audience familiarity and all scalar enums/ranges in the actual schema",()=>{
  const {input,schema,value,request,accepts}=setup();
  expect(schema.properties.familiarity.enum).toEqual(["unknown"]);
  for(const field of ["familiarity","searchMotif","subject","reaction","medium"]){
    const wrong={...value,[field]:"PRIVATE_UNKNOWN_ENUM"};
    expect(accepts(wrong)).toBe(false);
    expect(()=>validateExpressVisualPlan(wrong,input,request.review)).toThrow();
    for(const item of schema.properties[field].enum){
      const valid={...value,[field]:item};
      expect(accepts(valid)).toBe(true);
      expect(()=>validateExpressVisualPlan(valid,input,request.review)).not.toThrow();
    }
  }
  input.draft.preferences.familiarity="Some recipients know it.";
  const mixed=setup(input);
  for(const familiarity of ["unknown","mixed","familiar","unfamiliar"]){
    expect(mixed.accepts({...mixed.value,familiarity})).toBe(true);
    expect(validateExpressVisualPlan({...mixed.value,familiarity},input,mixed.request.review).familiarity).toBe(familiarity);
  }
  for(const subject of schema.properties.subject.enum)for(const reaction of schema.properties.reaction.enum)
    expect(validWebSearchTerms(`${subject} ${reaction} reaction`)).toBe(true);
  for(const subjectCount of schema.properties.subjectCount.enum)
    expect(validateExpressVisualPlan({...value,subjectCount},input,request.review).subjectCount).toBe(subjectCount);
});
it("binds observations to retained frames when the optional second frame is omitted",()=>{
  const {input,schema,value,request,accepts}=setup(makeInput("original"),2);
  expect(request.review.media.samples).toHaveLength(1);
  expect(schema.properties.observedSources.required).toEqual(["v1"]);
  expect(accepts(value)).toBe(true);
  expect(validateExpressVisualPlan(value,input,request.review)).toMatchObject({kind:"none",observedSources:["Known Work"],evidence:[]});
  const missing={...value,observedSources:{v1:null,v2:null}};
  expect(accepts(missing)).toBe(false);
  expect(()=>validateExpressVisualPlan(missing,input,request.review)).toThrow("model-output-invalid-schema");
  expect(accepts({...value,appearance:{style:"photographic",frameId:"v2"}})).toBe(false);
});
it("documents unavoidable lexical/semantic checks instead of claiming the wire schema enforces unsupported constraints",()=>{
  const {input,value,request,accepts}=setup(makeInput("explicit","Known Work"),1);
  const valid={...value,reference:{kind:"fictional",choice:"explicit",sourceId:"reference",work:"Known Work",
    characters:{first:null,second:null}}};
  for(const candidate of [
    {...valid,reason:""},{...valid,reason:" "},{...valid,reason:"x".repeat(321)},
    {...valid,replyIntent:"x".repeat(501)},{...valid,motif:"x".repeat(501)},{...valid,adaptedCaption:"x".repeat(501)},
    {...valid,adaptedCaption:"Invalid\ncaption"},
    {...valid,reference:{...valid.reference,work:"x".repeat(201)}},
    {...valid,reference:{...valid.reference,work:" Untrimmed name"}},
    {...valid,reference:{...valid.reference,work:"https://private.example"}},
    {...valid,reference:{...valid.reference,work:"PRIVATE_NAME_12345"}},
    {...valid,reference:{...valid.reference,work:"Unrequested Work"}},
    {...valid,observedSources:{v1:"https://private.example"}}
  ]){
    expect(accepts(candidate)).toBe(true);
    expect(()=>validateExpressVisualPlan(candidate,input,request.review)).toThrow();
  }
  const follow=setup(makeInput(),1);
  const unknownSource={...follow.value,observedSources:{v1:null},appearance:{style:"photographic",frameId:"v1"},
    reference:{kind:"fictional",choice:"same-source",sourceId:"v1",work:"Known Work",characters:{first:null,second:null}}};
  expect(follow.accepts(unknownSource)).toBe(true);
  expect(()=>validateExpressVisualPlan(unknownSource,follow.input,follow.request.review)).toThrow("model-output-invalid-references");
});
it("uses only supported structural schema features, with closed required objects and no empty enums",()=>{
  for(const frameCount of [0,1,2]){
    const {schema}=setup(makeInput(),frameCount);
    function visit(node:unknown){
      if(!node||typeof node!=="object")return;
      if(Array.isArray(node)){node.forEach(visit);return;}
      const value=node as Record<string,unknown>;
      for(const unsupported of ["minLength","maxLength","pattern","format","minItems","maxItems","uniqueItems","minimum","maximum","allOf","if","then"])
        expect(value).not.toHaveProperty(unsupported);
      if(Array.isArray(value.enum))expect(value.enum.length).toBeGreaterThan(0);
      if(value.type==="object"){
        expect(value.additionalProperties).toBe(false);
        expect([...(value.required as string[])].sort()).toEqual(Object.keys(value.properties as object).sort());
      }
      Object.values(value).forEach(visit);
    }
    visit(schema);expect(schema).not.toHaveProperty("anyOf");
  }
});
