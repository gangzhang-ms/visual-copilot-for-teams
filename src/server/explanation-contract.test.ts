import {expect,it,vi} from "vitest";
import {loadLocalChatConfig} from "./local-chat-config";
import {buildProcessingReview,ModelGateway,validateExplanation,validateProcessingExplanation} from "./model-gateway";
import {explanationKeys,explanationBriefInstruction,explanationResponseFormat,explanationReferenceCounts} from "./explanation-contract";
import type {ReviewInput,MediaPreview} from "../shared/types";

const input:ReviewInput={version:1,intent:"Explain the original owl.",context:[{label:"c1",text:"Fictional colleagues finished debugging.",timestamp:"",included:true}],
  preferences:{source:"requester-reported",confirmed:true,outputLanguage:"zh-CN",familiarity:"unknown",formality:"unknown",relationship:"unknown",humor:"",avoid:""}};
const valid=()=>({background:{source:null,context:null,frames:[]},observations:[{text:"An illustrated owl holds a cup.",frames:[]}],commonUsage:["Possible relief."],
  contextualInterpretations:[{text:"They may be glad to finish.",context:["c1"]}],uncertainties:["Intent is unknown."],safeResponseGuidance:["Ask whether everything works."]});
function fixture(){
  const config=loadLocalChatConfig("synthetic-key",true);
  const built=buildProcessingReview(input,{samples:[],coverage:[]},config.profile!,undefined,config.executionScope);
  config.localRequestDigests=new Set([built.review.digest]);
  return {config,built};
}
const envelope=(content:unknown=valid(),extra:Record<string,unknown>={})=>JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(content),...extra}}]});

it("omits only empty/default wire metadata while preserving full context, consent and coverage in review",()=>{
  const {config}=fixture(),profileBefore=structuredClone(config.profile);
  const reviewed:ReviewInput={...input,intent:"",preferences:{...input.preferences,familiarity:"",relationship:""},
    context:[{label:"owned",text:"Exact context 👩🏽‍💻 🙏🙂",timestamp:"",included:true}]};
  const media:MediaPreview={samples:[],coverage:[{mode:"sampled-stills",category:"gif",window:[0,1200],durationMs:1200,
    omitted:true,limitation:"Sampled stills only: no full playback or motion claim."}]};
  const built=buildProcessingReview(reviewed,media,config.profile!,undefined,config.executionScope);
  const body=JSON.parse(built.body),payload=JSON.parse(body.messages[1].content[0].text);
  expect(payload.context).toEqual([{label:"c0",text:reviewed.context[0].text}]);
  expect(payload.preferences).toEqual({source:"requester-reported",outputLanguage:"zh-CN"});
  expect(payload.intent).toBeUndefined();
  expect(payload.coverage).toEqual([{mode:"sampled-stills",category:"gif",window:[0,1200],durationMs:1200,omitted:true}]);
  expect(body.messages[0].content).toContain("Stills prove no motion/causality/unseen text");
  expect(built.review.media.coverage).toEqual(media.coverage);expect(reviewed.preferences.confirmed).toBe(true);
  expect(config.profile).toEqual(profileBefore);
  expect(()=>buildProcessingReview({...reviewed,preferences:{...reviewed.preferences,confirmed:false}},media,config.profile!,undefined,config.executionScope))
    .toThrow("processing-review-required");
  const legacy=JSON.parse(buildProcessingReview(reviewed,media,{...config.profile!,explanationFormat:undefined},undefined,config.executionScope).body);
  const legacyPayload=JSON.parse(legacy.messages[1].content[0].text);
  expect(legacyPayload.preferences).toEqual(reviewed.preferences);expect(legacyPayload.coverage).toEqual(media.coverage);expect(legacyPayload.intent).toBe("");
});
it("retains every populated preference and explicit intent in structured requests",()=>{
  const {config}=fixture();
  const reviewed:ReviewInput={...input,preferences:{...input.preferences,formality:"formal",familiarity:"First meeting",
    relationship:"Colleagues",humor:"Gentle",avoid:"No teasing"}};
  const built=buildProcessingReview(reviewed,{samples:[],coverage:[]},config.profile!,undefined,config.executionScope);
  const payload=JSON.parse(JSON.parse(built.body).messages[1].content[0].text);
  const {confirmed,...preferences}=reviewed.preferences;
  expect(confirmed).toBe(true);expect(payload.preferences).toEqual(preferences);expect(payload.intent).toBe(reviewed.intent);
});

it("reproduces zero unknown references yet rejects a named emoji background without pixels",()=>{
  const output={...valid(),background:{source:"Unicode emoji",context:"Standard character symbols",frames:[]},
    observations:[{text:"Folded hands and a slight smile.",frames:[]}],
    contextualInterpretations:[{text:"May be thanks.",context:["c2"]},{text:"Could be a request.",context:["c4"]}]};
  const labels=["c0","c1","c2","c3","c4"],counts=explanationReferenceCounts(output,[],labels);
  expect(counts).toMatchObject({background:{references:0,unknown:0,sourceKind:"named",contextKind:"named"},
    frames:{items:1,references:0,unknown:0},context:{items:2,references:2,unknown:0}});
  expect(()=>validateProcessingExplanation(output,[],labels,true)).toThrow("model-output-invalid-references");
  expect(explanationResponseFormat([],labels).json_schema.schema.properties.background.properties.source).not.toHaveProperty("enum");
  const corrected={...output,background:{source:null,context:null,frames:[]}};
  expect(validateProcessingExplanation(corrected,[],labels,true)).toEqual(corrected);
});
it("constrains Unicode background to null and empty evidence arrays without changing visual schemas",()=>{
  const {config}=fixture();
  const built=buildProcessingReview({...input,explanationTarget:{kind:"emoji",emoji:"🙏 🙂 👩🏽‍💻"}},
    {samples:[],coverage:[]},config.profile!,undefined,config.executionScope);
  const body=JSON.parse(built.body),schema=body.response_format.json_schema.schema.properties;
  expect(body.response_format.json_schema.name).toBe("unicode_emoji_explanation_v1");
  expect(schema.background.properties.source).toEqual({type:["string","null"],enum:[null]});
  expect(schema.background.properties.context).toEqual({type:["string","null"],enum:[null]});
  expect(schema.background.properties.frames).toEqual({type:"array",items:{type:"string"},maxItems:0});
  expect(schema.observations.items.properties.frames.maxItems).toBe(0);
  expect(schema.contextualInterpretations.items.properties.context.items.enum).toEqual(["c0"]);
  expect(body.messages[0].content).toContain('background MUST be {"source":null,"context":null,"frames":[]}');
  expect(body.messages[1].content).toHaveLength(1);
  const empty=explanationResponseFormat([],[],true).json_schema.schema.properties;
  expect(empty.contextualInterpretations.items.properties.context).toMatchObject({maxItems:0});
  const visual=explanationResponseFormat(["f0"],["c0"]).json_schema;
  expect(visual.name).toBe("visual_explanation_v2");
  expect(visual.schema.properties.background.properties.source).toEqual({type:["string","null"]});
  expect(visual.schema.properties.background.properties.frames).toEqual({type:"array",items:{type:"string",enum:["f0"]}});
});
it("rejects the captured custom-image null-origin/nonempty-evidence failure without rewriting it",()=>{
  const output={...valid(),background:{source:null,context:null,frames:["f0"]},
    observations:[{text:"A smiling face with a blue tear.",frames:["f0"]}],
    contextualInterpretations:[{text:"It could be grateful happiness.",context:["c6"]}]};
  const snapshot=structuredClone(output);
  expect(()=>validateProcessingExplanation(output,["owned-image"],Array.from({length:7},(_,i)=>`message-${i}`),true))
    .toThrow("model-output-invalid-schema");
  expect(output).toEqual(snapshot);
  const schema=explanationResponseFormat(["f0"],["c0","c1","c6"],false,true).json_schema.schema.properties;
  expect(schema.background.properties.frames).toMatchObject({maxItems:0});
  expect(schema.background.properties.source).toMatchObject({enum:[null]});
  expect(schema.observations.items.properties.frames).toMatchObject({items:{enum:["f0"]}});
  const compliant={...output,background:{source:null,context:null,frames:[]},contextualInterpretations:[{text:"The selected reply may convey mixed feelings.",context:["c1"]}]};
  expect(validateProcessingExplanation(compliant,["owned-image"],["message-0","selected-message"],true)).toMatchObject({
    observations:[{frames:["owned-image"]}],contextualInterpretations:[{context:["selected-message"]}]
  });
});
it.each(["f0","c0","U+1F64F","🙏","unselected-message"])("still rejects fabricated Unicode frame evidence %s",ref=>{
  expect(()=>validateProcessingExplanation({...valid(),observations:[{text:"Folded hands",frames:[ref]}]},
    [],["owned-A","owned-B"],true)).toThrow("model-output-invalid-references");
});
it("rejects unreviewed, swapped and original message IDs instead of repairing references",()=>{
  for(const ref of ["c2","f0","owned-A","not-selected"]){
    expect(()=>validateProcessingExplanation({...valid(),contextualInterpretations:[{text:"Maybe thanks",context:[ref]}]},
      [],["owned-A","owned-B"],true)).toThrow("model-output-invalid-references");
  }
  expect(validateProcessingExplanation({...valid(),contextualInterpretations:[{text:"Maybe thanks",context:["c1","c0"]}]},
    [],["owned-A","owned-B"],true).contextualInterpretations[0].context).toEqual(["owned-B","owned-A"]);
});

it("reproduces observed HTTP200/stop shape: five unknown frame references, five valid contexts",()=>{
  const output={...valid(),observations:Array.from({length:5},()=>({text:"An illustrated owl holds a cup.",frames:["unsupplied-frame"]})),
    contextualInterpretations:Array.from({length:5},()=>({text:"Possible relief after debugging.",context:["c1"]}))};
  expect(()=>validateExplanation(output,["frame-A","frame-B"],["c1"])).toThrow("model-output-invalid-references");
  const corrected={...output,observations:output.observations.map(o=>({...o,frames:["frame-A"]}))};
  expect(validateExplanation(corrected,["frame-A","frame-B"],["c1"])).toEqual(corrected);
  corrected.contextualInterpretations[0].context=["invented-context"];
  expect(()=>validateExplanation(corrected,["frame-A","frame-B"],["c1"])).toThrow("model-output-invalid-references");
});
it("pins structured explanation to supported local profile and budgets the complete schema",()=>{
  const {built,config}=fixture(),body=JSON.parse(built.body),format=body.response_format;
  expect(format).toMatchObject({type:"json_schema",json_schema:{strict:true,schema:{required:[...explanationKeys],additionalProperties:false}}});
  expect(format.json_schema.schema.properties.contextualInterpretations.items.properties.context.items.enum).toEqual(["c0"]);
  expect(format.json_schema.schema.properties.observations.items.properties.frames.items.enum).toBeUndefined();
  expect(format.json_schema.schema.properties.background).toMatchObject({required:["source","context","frames"],additionalProperties:false,
    properties:{source:{type:["string","null"]},context:{type:["string","null"]}}});
  expect(built.review.inputTokens).toBe(Buffer.byteLength(body.messages[0].content+body.messages[1].content[0].text+JSON.stringify(format))+512);
  expect(()=>buildProcessingReview(input,{samples:[],coverage:[]},{...config.profile!,inputTokens:built.review.inputTokens-1},undefined,config.executionScope)).toThrow("request-token-budget-exceeded");
  expect(JSON.parse(buildProcessingReview(input,{samples:[],coverage:[]},{...config.profile!,explanationFormat:undefined},undefined,config.executionScope).body).response_format).toEqual({type:"json_object"});
});
it("keeps emoji target separate from sentence context and rejects a sentence or absent visual as target",()=>{
  const {config}=fixture();
  const build=(target:ReviewInput["explanationTarget"])=>buildProcessingReview({...input,explanationTarget:target},{samples:[],coverage:[]},config.profile!,undefined,config.executionScope);
  const body=JSON.parse(build({kind:"emoji",emoji:"👩🏽‍💻 ❤️"}).body),payload=JSON.parse(body.messages[1].content[0].text);
  expect(payload.target).toEqual({kind:"emoji",emoji:"👩🏽‍💻 ❤️"});
  expect(payload.context[0].text).toBe(input.context[0].text);
  expect(payload.frames).toEqual([]);
  expect(()=>build({kind:"emoji",emoji:"Summarize the conversation 🙂"})).toThrow("processing-review-required");
  expect(()=>build({kind:"visual"})).toThrow("processing-review-required");
});
it("requests a short contextual first entry in both formats without shortening valid long results or token reserves",()=>{
  const {config}=fixture();
  for(const explanationFormat of ["json-schema",undefined] as const){
    const built=buildProcessingReview(input,{samples:[],coverage:[]},{...config.profile!,explanationFormat},undefined,config.executionScope);
    const body=JSON.parse(built.body);
    expect(body.messages[0].content).toContain(explanationBriefInstruction);
    expect(body.messages[0].content).toContain("max30 English words/60 Chinese chars");
    expect(body.messages[0].content).toContain("source=named work/franchise/quote/meme origin");
    expect(body.messages[0].content).toContain("NEVER chat/captions or generic usage");
    expect(body.messages[0].content).toContain("If unsure: source/context:null,frames:[]");
    expect(body.messages[0].content).toContain("No actor/scene guesses");
    if(explanationFormat==="json-schema"){
      const oldFormat=structuredClone(body.response_format);
      delete oldFormat.json_schema.schema.properties.background;
      oldFormat.json_schema.schema.required=oldFormat.json_schema.schema.required.filter((key:string)=>key!=="background");
      expect(Buffer.byteLength(body.messages[0].content+JSON.stringify(body.response_format)))
        .toBeLessThanOrEqual(1020+Buffer.byteLength(JSON.stringify(oldFormat)));
    }
    expect(body[config.profile!.completionField]).toBe(Math.min(2000,config.profile!.outputTokens));
    const output={...valid(),contextualInterpretations:[{text:"Possibly ".repeat(110).trim(),context:["c1"]}]};
    expect(validateExplanation(output,[],["c1"])).toEqual(output);
  }
});
it("requires explicit source semantics, rejects missing background and never promotes generic common usage",()=>{
  const {background,...old}=valid();
  expect(()=>validateExplanation(old,["frame-A"],["c1"])).toThrow("model-output-invalid-schema");
  for(const bad of [null,{}, {source:null,context:"Generic control meme",frames:[]},
    {source:null,context:null,frames:["frame-A"]},{source:"",context:"Original scene",frames:["frame-A"]},
    {source:"A work",context:null,frames:["frame-A"]},{source:"A work",context:"Scene",frames:[],extra:true}]){
    expect(()=>validateExplanation({...valid(),background:bad},["frame-A"],["c1"])).toThrow("model-output-invalid-schema");
  }
  expect(validateExplanation({...valid(),commonUsage:["Generic control meme"]},[],["c1"]).background).toEqual(background);
  for(const evidence of [[],["invented"]]){
    expect(()=>validateExplanation({...valid(),background:{source:"Alice in Wonderland",context:"An unfamiliar world.",frames:evidence}},["frame-A"],["c1"]))
      .toThrow("model-output-invalid-references");
  }
});
it("maps independently cited origin evidence without using conversation references",()=>{
  const output={...valid(),contextualInterpretations:[{text:"Possible reading",context:["c0"]}],
    background:{source:"Alice in Wonderland",context:"An unfamiliar world.",frames:["f0"]}};
  const mapped=validateProcessingExplanation(output,["owned-frame"],["owned-context"],true);
  expect(mapped.background).toEqual({...output.background,frames:["owned-frame"]});
  output.background.frames=["c0"];
  expect(()=>validateProcessingExplanation(output,["owned-frame"],["owned-context"],true)).toThrow("model-output-invalid-references");
});
it.each([null,[],{}, {...valid(),extra:"not allowed"}, {...valid(),observations:[null]}, {...valid(),observations:[{text:"x",frames:[null]}]},
  {...valid(),commonUsage:[]},{...valid(),commonUsage:Array(9).fill("x")},{...valid(),uncertainties:["x".repeat(1001)]},
  {...valid(),safeResponseGuidance:["<unsafe>"]},{...valid(),commonUsage:["line\nbreak"]}])("retains strict malformed/text/count boundaries %#",output=>{
  expect(()=>validateExplanation(output,[],["c1"])).toThrow("model-output-invalid-schema");
});
it.each([
  [401,"model-provider-auth"],[403,"model-provider-auth"],[404,"model-provider-unavailable"],[503,"model-provider-unavailable"],[429,"busy"]
] as const)("distinguishes HTTP %s without provider body disclosure or local retries",async(status,code)=>{
  const {config,built}=fixture(),transport=vi.fn(async()=>new Response("PRIVATE_PROVIDER_BODY",{status}));
  await expect(new ModelGateway(config,transport).run(built.body,built.review,new AbortController().signal)).rejects.toThrow(code);
  expect(transport).toHaveBeenCalledTimes(1);
});
it.each([
  ["not-json","model-output-invalid-json"],
  [JSON.stringify({choices:[{finish_reason:"stop",message:{content:"not-json"}}]}),"model-output-invalid-json"],
  [JSON.stringify({choices:[{finish_reason:"length",message:{content:"{}"}}]}),"model-output-truncated"],
  [JSON.stringify({choices:[{finish_reason:"content_filter",message:{content:null}}]}),"model-refused"],
  [envelope(null,{refusal:"PRIVATE_REFUSAL"}),"model-refused"],
  [envelope({refused:true}),"model-refused"],
  [envelope(valid(),{tool_calls:[{type:"function"}]}),"model-output-invalid-envelope"],
  [envelope(valid(),{function_call:{name:"forbidden"}}),"model-output-invalid-envelope"],
  [JSON.stringify({choices:[]}),"model-output-invalid-envelope"]
] as const)("classifies response boundary %# with no repair/retry",async(body,code)=>{
  const {config,built}=fixture(),transport=vi.fn(async()=>new Response(body));
  await expect(new ModelGateway(config,transport).run(built.body,built.review,new AbortController().signal)).rejects.toThrow(code);
  expect(transport).toHaveBeenCalledTimes(1);
});
it("accepts an empty tool_calls list but never executes tools",async()=>{
  const {config,built}=fixture(),transport=vi.fn(async()=>new Response(envelope(valid(),{tool_calls:[]})));
  const output=await new ModelGateway(config,transport).run(built.body,built.review,new AbortController().signal);
  expect(validateExplanation(output,[],["c1"])).toEqual(valid());expect(transport).toHaveBeenCalledTimes(1);
});
it("maps only validated compact references back to exact reviewed source IDs",()=>{
  const output={...valid(),observations:[{text:"Owl",frames:["f1","f0"]}],contextualInterpretations:[{text:"Maybe relief",context:["c1"]}]};
  expect(validateProcessingExplanation(output,["owned-frame-A","owned-frame-B"],["context-A","context-B"],true)).toMatchObject({
    observations:[{frames:["owned-frame-B","owned-frame-A"]}],contextualInterpretations:[{context:["context-B"]}]
  });
  output.observations[0].frames=["owned-frame-A"];
  expect(()=>validateProcessingExplanation(output,["owned-frame-A","owned-frame-B"],["context-A","context-B"],true)).toThrow("model-output-invalid-references");
});
it("emits only bounded diagnostic metadata, never response text, IDs, profiles or credentials",async()=>{
  const {config,built}=fixture(),diagnostic=vi.fn(),output={...valid(),observations:[{text:"PRIVATE_MODEL_TEXT",frames:["PRIVATE_UNKNOWN_ID"]}]};
  await new ModelGateway(config,async()=>new Response(envelope(output)),diagnostic).run(built.body,built.review,new AbortController().signal);
  expect(diagnostic).toHaveBeenCalledTimes(1);
  expect(diagnostic.mock.calls[0][0]).toMatchObject({httpStatus:200,finishReason:"stop",stage:"decoded",references:{frames:{items:1,references:1,unknown:1}}});
  expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/PRIVATE_|synthetic-key|Fictional colleagues|c1/);
});
it("distinguishes transport failure; cancellation wins and retains the active request until transport settles",async()=>{
  const {config,built}=fixture();
  await expect(new ModelGateway(config,async()=>{throw new TypeError("PRIVATE_NETWORK_DETAIL");}).run(built.body,built.review,new AbortController().signal)).rejects.toThrow("model-network-error");
  const abort=new AbortController();let release!:(response:Response)=>void;
  const transport=vi.fn(()=>new Promise<Response>(resolve=>{release=resolve;})),gateway=new ModelGateway(config,transport);
  const pending=gateway.run(built.body,built.review,abort.signal);let settled=false;
  const checked=expect(pending).rejects.toThrow("cancelled").then(()=>{settled=true;});
  abort.abort();await Promise.resolve();expect(settled).toBe(false);
  release(new Response(envelope()));await checked;expect(transport).toHaveBeenCalledTimes(1);
});
