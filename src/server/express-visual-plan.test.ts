import {beforeAll,it,expect,vi} from "vitest";
import * as gateway from "./model-gateway";
import sharp from "sharp";
import {buildExpressVisualPlan,validateResolvedVisualPlan as validateExpressVisualPlan} from "./express-visual-plan";
import {buildSearchQueryPlan} from "./image-search-query";
import {buildCreativeBrief} from "./local-generation";
import {buildSourceRanking,validateSourceRanking} from "./meme-source-ranking";
import {loadLocalChatConfig} from "./local-chat-config";
import {offlineDraft} from "./generation.test.support";
import type {MediaPreview} from "../shared/types";
import {digest} from "./analysis-session";
import {localDemo} from "./local-demo";
import {emptySpeakerProfile} from "../shared/expression";
import type {SourceRankingInput} from "./meme-source-ranking";
let visual:MediaPreview;
const config=loadLocalChatConfig("OFFLINE",true);
const input=()=>({draft:{...offlineDraft(),intent:"Work work",context:[{label:"incoming",text:"PRIVATE_PROJECT_771: one portal for all work",included:true}]}});
const result={searchMotif:"none",hook:null,referenceChoice:"same-source",replyIntent:"A tired response to repetitive work",reason:"Retain the recognized fictional world",adaptedCaption:null,familiarity:"unknown",
  observedSources:["Gandalf"],mode:"inherit",kind:"fictional",franchise:"The Lord of the Rings",characters:["Gandalf"],subject:"wizard",
  reaction:"exhausted",medium:"movie",visualStyle:"photographic",motif:"A weary wizard facing repetitive demands",subjectCount:1,certainty:"grounded",evidence:["v1"]};
beforeAll(async()=>{
  const bytes=await sharp({create:{width:64,height:64,channels:3,background:"#248"}}).png().toBuffer();
  visual={samples:[{id:"owned-frame",assetId:"incoming",digest:digest(bytes),mime:"image/png",width:64,height:64,bytes:bytes.length,
    timestampMs:0,frameIndex:0,dataUrl:`data:image/png;base64,${bytes.toString("base64")}`}],coverage:[]};
});
it("reproduces the old missing-pixel/anchor payload and binds the new plan to both actual generation prompts",()=>{
  const draft=input(),old=JSON.parse(buildSearchQueryPlan(draft,config.profile!,config.executionScope!).body);
  expect(old.messages[1].content).toHaveLength(1);expect(JSON.parse(old.messages[1].content[0].text).context).toEqual([]);
  const request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!),body=JSON.parse(request.body);
  expect(body.messages[1].content[1].image_url.url).toBe(visual.samples[0].dataUrl);
  expect(JSON.parse(body.messages[1].content[0].text).context).toHaveLength(1);
  const plan=validateExpressVisualPlan(result,draft,request.review);
  expect(plan.query).toContain("Gandalf");expect(plan.query).toContain("exhausted");expect(plan.query).not.toMatch(/PRIVATE|771|portal/);
  const before=buildCreativeBrief(draft.draft,[{id:"incoming"}],undefined,{treatment:"natural-photo"});
  expect(before.prompt).not.toContain("Gandalf");
  for(const treatment of ["natural-photo","cinematic-photo"] as const){
    const after=buildCreativeBrief(draft.draft,[{id:"incoming"}],undefined,{treatment,contextPlan:plan});
    expect(JSON.parse(after.body).prompt).toContain('"characters":["Gandalf"]');
    expect(after.prompt).toContain('"franchise":"The Lord of the Rings"');
    expect(after.prompt).toContain('"reaction":"exhausted"');
    expect(after.prompt).toContain("not reference pixels");
  }
});
it.each([["en",false],["en",true],["zh-CN",false],["zh-CN",true]] as const)("fits the actual nine-message %s demo (prior explanation: %s) without changing the profile",async(language,explained)=>{
  const messages=await localDemo(language,"combined"),draft:SourceRankingInput=input();
  draft.draft.intent="A lighthearted reply agreeing to a small dashboard pilot while keeping the old links.";
  draft.draft.creative="";
  draft.draft.expression={style:"auto",intensity:"auto",reference:"",culturalMode:"follow-conversation"};
  draft.draft.preferences.language=language;
  draft.draft.context=messages.map((m,i)=>({label:String(i),text:`${m.speaker}: ${m.text}`,included:true}));
  draft.contextRoles=messages.map((m,i)=>({label:String(i),speaker:m.speaker,role:m.speaker==="Alex"?"outgoing":"other"}));
  draft.visualOrigins=messages.map((_,i)=>({label:String(i),origin:"conversation-image"}));
  if(explained){
    draft.knownSources=[{label:"1",source:"The Lord of the Rings",context:"A fictional fellowship facing a difficult shared task"}];
    draft.draft.preferences.familiarity="Some know the films, others do not";
  }
  const source={samples:[...visual.samples,...visual.samples].map((s,i)=>({...s,assetId:String(i+1)})),coverage:[]};
  const original=gateway.preflight;
  const accounting=vi.spyOn(gateway,"preflight").mockImplementation((...args)=>{
    expect(args[3]+args[2].samples.length*args[1].imageTokenUpperBound+512).toBeLessThanOrEqual(8500);
    return original(...args);
  });
  try{
    const request=buildExpressVisualPlan(draft,source,config.profile!,config.executionScope!);
    expect(request.review.inputTokens).toBeLessThanOrEqual(8500);expect(request.review.imageCount).toBe(1);
    expect(JSON.parse(JSON.parse(request.body).messages[1].content[0].text).context).toHaveLength(9);
  }finally{accounting.mockRestore();}
});
it("preserves a game anchor and explicit subject count in both variations",()=>{
  const draft=input(),request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan(  {...result,observedSources:["Master Chief"],franchise:"Halo",characters:["Master Chief"],subject:"hero",medium:"video game",subjectCount:2},draft,request.review);
  expect(plan.query).toContain("Master Chief");
  for(const treatment of ["natural-photo","cinematic-photo"] as const){
    expect(buildCreativeBrief(draft.draft,[{id:"incoming"}],undefined,{treatment,contextPlan:plan}).prompt).toContain('"subjectCount":2');
  }
});
it("same-work cast can differ from observed characters, while explicit reference mode cannot silently inherit another cast",()=>{
  const draft=input(),request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...result,characters:["Boromir"],subject:"hero",reaction:"skeptical",
    replyIntent:"Support a small pilot, retaining old links",reason:"A cautious same-work character suits a measured change"},draft,request.review);
  expect(plan.observedSources).toEqual(["Gandalf"]);expect(plan.characters).toEqual(["Boromir"]);
  expect(plan.franchise).toBe(result.franchise);
  expect(JSON.parse(request.body).messages[0].content).toContain("not necessarily pictured cast; keep explicitly requested characters");
  const prompt=buildCreativeBrief(draft.draft,[{id:"incoming"}],undefined,{treatment:"natural-photo",contextPlan:plan}).prompt;
  expect(prompt).toContain('"characters":["Boromir"]');expect(prompt).not.toContain("Gandalf");
  draft.draft.expression={style:"auto",intensity:"auto",reference:"Gandalf",culturalMode:"explicit"};
  expect(()=>validateExpressVisualPlan({...result,characters:["Boromir"]},draft,request.review)).toThrow("model-output-invalid-references");
  expect(validateExpressVisualPlan({...result,mode:"override",referenceChoice:"explicit"},draft,request.review).characters).toEqual(["Gandalf"]);
});
it("explicit cat override removes incoming fictional names without losing reaction/count",()=>{
  const draft=input();draft.draft.intent="This time no movie: two cats, exhausted";
  const request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...result,referenceChoice:"original",mode:"override",kind:"motif",franchise:null,characters:[],subject:"cat",
    subjectCount:2,motif:"Two tired cats",medium:"photo",visualStyle:"unknown",evidence:[]},draft,request.review);
  expect(plan.query).toContain("cat");expect(plan.query).not.toContain("Gandalf");
  for(const treatment of ["natural-photo","cinematic-photo"] as const){
    const prompt=buildCreativeBrief(draft.draft,[{id:"incoming"}],undefined,{treatment,contextPlan:plan}).prompt;
    expect(prompt).toContain('"subjectCount":2');expect(prompt).not.toContain("Gandalf");
  }
  expect(()=>validateExpressVisualPlan({...result,mode:"override"},draft,request.review)).toThrow();
});
it.each(["Just exhausted","😩"])("handles text/emoji without fabricated identity or images: %s",intent=>{
  const draft=input();draft.draft.intent=intent;
  const request=buildExpressVisualPlan(draft,{samples:[],coverage:[]},config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...result,referenceChoice:"original",observedSources:[],mode:"unanchored",kind:"none",franchise:null,characters:[],subject:"person",
    certainty:"none",visualStyle:"unknown",medium:"unknown",evidence:[],motif:"An exhausted reaction"},draft,request.review);
  expect(request.review.imageCount).toBe(0);expect(plan.query).toContain("reaction");
  expect(()=>validateExpressVisualPlan(result,draft,request.review)).toThrow();
});
it("unknown faces retain a motif, not an actor guess or an unsupported title",()=>{
  const draft=input(),request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  expect(request.body).toContain("NEVER identify real people/actors by face");
  const unknown={...result,referenceChoice:"original",observedSources:[null],kind:"motif",franchise:null,characters:[],subject:"person",certainty:"uncertain",motif:"A surprised look"};
  expect(validateExpressVisualPlan(unknown,draft,request.review).franchise).toBeNull();
  expect(()=>validateExpressVisualPlan({...unknown,franchise:"Invented Film"},draft,request.review)).toThrow();
  expect(validateExpressVisualPlan({...unknown,observedSources:["Gandalf"]},draft,request.review).franchise).toBeNull();
  expect(validateExpressVisualPlan({...unknown,mode:"unanchored",observedSources:["Gandalf"]},draft,request.review).referenceChoice).toBe("original");
});
it("rejects stale/unknown evidence, secret-shaped references and excess input",()=>{
  const draft=input(),request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  for(const bad of [{...result,evidence:["other-room"]},{...result,franchise:"PRIVATE_PROJECT_771"},
    {...result,franchise:"https://internal.example"},{...result,extra:"private query"},{...result,certainty:"uncertain"}]){
    expect(()=>validateExpressVisualPlan(bad,draft,request.review)).toThrow();
  }
  expect(()=>buildExpressVisualPlan(draft,{samples:[...visual.samples,...visual.samples,...visual.samples],coverage:[]},config.profile!,config.executionScope!)).toThrow();
  expect(()=>buildExpressVisualPlan(draft,{samples:visual.samples.map(s=>({...s,assetId:"other-room"})),coverage:[]},config.profile!,config.executionScope!)).toThrow();
  expect(()=>buildExpressVisualPlan({draft:{...draft.draft,visualContextId:"other-room"}},visual,config.profile!,config.executionScope!)).toThrow();
  expect(()=>buildExpressVisualPlan({draft:{...draft.draft,context:Array.from({length:11},(_,i)=>({label:String(i),text:"x",included:true}))}},visual,config.profile!,config.executionScope!)).toThrow();
});
it("rejects same-topic advertising and incoherent results, but not a legitimate challenge-accepted meme",()=>{
  const draft=input(),request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan(result,draft,request.review);
  const templates=[{id:"ad",name:"10-Day Burnout & Exhaustion Challenge",url:"https://example.com/ad",width:1,height:1,box_count:1},
    {id:"meme",name:"Gandalf challenge accepted reaction meme",url:"https://example.com/meme",width:1,height:1,box_count:1}];
  const built=buildSourceRanking({...draft,contextPlan:plan},templates,config.profile!,config.executionScope!,true);
  expect(built.body).toContain("Generic topic overlap is insufficient");
  const good={id:"meme",reason:"Same character and reaction",kind:"reaction-meme",anchorMatch:"matched",reactionMatch:true};
  expect(validateSourceRanking(good,templates,plan)?.id).toBe("meme");
  for(const bad of [{...good,id:"ad",kind:"advertisement"},{...good,anchorMatch:"unknown"},{...good,reactionMatch:false}]){
    expect(validateSourceRanking(bad,templates,plan)).toBeUndefined();
  }
  expect(()=>validateSourceRanking({...good,id:"invented"},templates,plan)).toThrow();
});
it.each([
  ["movie","photographic","live-action/photographic"],
  ["movie","illustrated","drawn, illustrated or anime"],
  ["animation","illustrated","drawn, illustrated or anime"],
  ["photo","photographic","live-action/photographic"],
  ["video game","rendered","rendered/game"],
  ["unknown","unknown","Visual style is uncertain"]
])("both Auto variants preserve %s / %s instead of assuming movie or GIF means a style", (medium,visualStyle,direction)=>{
  const draft=input();draft.draft.expression={style:"auto",intensity:"auto",reference:""};
  const request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...result,medium,visualStyle},draft,request.review);
  const variants=(["natural-photo","cinematic-photo"] as const).map(treatment=>
    JSON.parse(buildCreativeBrief(draft.draft,[{id:"incoming"}],undefined,{treatment,contextPlan:plan}).prompt.split("\n").at(-1)!));
  for(const variant of variants){
    expect(variant.contextDirection.visualStyle).toBe(visualStyle);
    expect(variant.contextDirection.characters).toEqual(["Gandalf"]);
    expect(variant.styleDirection).toContain(direction);
  }
  expect(variants[0].styleDirection).toBe(variants[1].styleDirection);
  expect(variants[0].treatment).not.toBe(variants[1].treatment);
  expect(request.body).toContain("GIF and meme are containers, not styles");
  if(visualStyle==="illustrated")expect(plan.query).toContain("illustration");
});
it("explicit output style overrides inherited appearance without substituting the cast",()=>{
  const draft=input();draft.draft.expression={style:"light-comic",intensity:"auto",reference:""};
  const request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan(result,draft,request.review);
  expect(plan.visualStyle).toBe("photographic");expect(plan.query).toContain("illustration");
  for(const treatment of ["natural-photo","cinematic-photo"] as const){
    const value=buildCreativeBrief(draft.draft,[{id:"incoming"}],undefined,{treatment,contextPlan:plan});
    const payload=JSON.parse(value.prompt.split("\n").at(-1)!);
    expect(payload.styleDirection).toContain("single-panel reaction comic");
    expect(payload.contextDirection.characters).toEqual(["Gandalf"]);
    expect(value.prompt).toContain("explicit requested output style takes precedence");
    expect(value.prompt).not.toContain("Default to an original live-action");
  }
});
it("known style requires owned frame evidence and unknown style never invents a match",()=>{
  const draft=input(),request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  for(const bad of [{...result,visualStyle:"cartoon-from-filename"},{...result,evidence:[]},
    {...result,visualStyle:undefined},{...result,evidence:["v2"]}]){
    expect(()=>validateExpressVisualPlan(bad,draft,request.review)).toThrow();
  }
  const unknown=validateExpressVisualPlan({...result,referenceChoice:"original",observedSources:[null],kind:"motif",franchise:null,characters:[],
    medium:"unknown",visualStyle:"unknown",certainty:"uncertain",evidence:[]},draft,request.review);
  expect(unknown.query).not.toMatch(/Gandalf|movie|photo|illustration/);
});
it("source query and ranking retain an illustrated work anchor without a photographic preference",()=>{
  const draft=input(),request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...result,visualStyle:"illustrated"},draft,request.review);
  expect(plan.query).toContain("Gandalf");expect(plan.query).toContain("illustration");
  const ranked=JSON.parse(buildSourceRanking({...draft,contextPlan:plan},
    [{id:"drawn",name:"Illustrated Gandalf exhausted reaction",url:"https://example.com/fixture.png",width:256,height:256,box_count:2}],
    config.profile!,config.executionScope!,true).body);
  expect(ranked.messages[0].content).toContain("Do not prefer photography over an illustrated/anime anchor");
  expect(ranked.messages[0].content).not.toContain("Prefer a fitting photographic/movie reaction");
  expect(JSON.parse(ranked.messages[1].content[0].text).contextDirection).toMatchObject({
    franchise:"The Lord of the Rings",characters:["Gandalf"],medium:"movie",visualStyle:"illustrated"
  });
});
  it.each([
    ["One portal to rule them all?","The Lord of the Rings","Boromir","One does not simply replace every link"],
    ["Help me, Obi-Wan Kenobi; you're my only hope.","Star Wars","Obi-Wan Kenobi","A small pilot is a good first step"]
  ])("grounds a film allusion in reviewed text, not a hardcoded title: %s",(cue,franchise,character,caption)=>{
    const draft=input();draft.draft.intent="A lighthearted reply agreeing to a small pilot while keeping the old links";
    draft.draft.creative="";draft.draft.context[0].text=cue;
    const request=buildExpressVisualPlan(draft,{samples:[],coverage:[]},config.profile!,config.executionScope!);
    const plan=validateExpressVisualPlan({...result,observedSources:[],franchise,characters:[character],visualStyle:"unknown",evidence:["c1"],
      reaction:"relieved",replyIntent:"Agree to a modest pilot; keep old links",adaptedCaption:caption,
      motif:"The named companion steadies a small trial gate beside an open, established path"},draft,request.review);
    expect(plan.franchise).toBe(franchise);expect(plan.evidence).toEqual(["c1"]);
    expect(request.body).not.toContain('"type":"image_url"');
    const built=buildCreativeBrief(draft.draft,[{id:"incoming"}],undefined,{treatment:"natural-photo",contextPlan:plan});
    expect(built.prompt).toContain(caption);expect(built.prompt).toContain("NOT a verbatim film quote");
    expect(built.prompt).toContain("not an actual movie frame");
    expect(built.prompt).toContain("Unknown audience familiarity calls for a self-explanatory gesture, not removal of the supported source identity");
    expect(built.prompt).toContain("recognizable in the imagery with the caption hidden");
    expect(JSON.parse(built.prompt.split("\n").at(-1)!).contextDirection).toMatchObject({
      franchise,characters:[character],familiarity:"unknown",
      motif:"The named companion steadies a small trial gate beside an open, established path"
    });
    const wire=JSON.parse(request.body);
    expect(wire.response_format.json_schema.name).toBe("express_visual_plan_v12");
    expect(wire.response_format.json_schema.schema.$defs.s.enum).toContain("c1");
    expect(wire.messages[0].content).not.toContain(franchise);
  });
  it("uses prior explanation evidence only for included messages and keeps ownership-scoped roles",()=>{
    const draft:SourceRankingInput=input();
    draft.knownSources=[{label:"incoming",source:"The Lord of the Rings",context:"A fictional fellowship with a difficult task"},
      {label:"excluded",source:"Unrelated title",context:"Not reviewed"}];
    draft.contextRoles=[{label:"incoming",speaker:"Maya",role:"other"}];
    draft.visualOrigins=[{label:"incoming",origin:"generated-interpretation"}];
    const request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
    const payload=JSON.parse(JSON.parse(request.body).messages[1].content[0].text);
    expect(payload.knownSources).toEqual([{id:"k1",context:"c1",source:"The Lord of the Rings",background:"A fictional fellowship with a difficult task"}]);
    expect(payload.context[0]).toMatchObject({role:"other",speaker:"Maya"});
    expect(payload.frames[0].origin).toBe("generated-interpretation");
    const plan=validateExpressVisualPlan({...result,observedSources:[null],evidence:["k1"],visualStyle:"unknown"},draft,request.review);
    expect(plan.franchise).toBe("The Lord of the Rings");
    expect(()=>validateExpressVisualPlan({...result,evidence:["k2"]},draft,request.review)).toThrow("model-output-invalid-references");
    expect(()=>validateExpressVisualPlan({...result,evidence:["k1"]},draft,request.review)).toThrow("model-output-invalid-references");
  });
  it.each(["","Some know the films, some have never seen them"])("separates voluntary speaker and audience familiarity: %s",familiarity=>{
    const draft:SourceRankingInput=input();draft.draft.preferences.familiarity=familiarity;
    draft.speakerContext={role:"outgoing-speaker",source:"voluntary-local-report",profile:{...emptySpeakerProfile(),familiarity:"I know this film",culture:"I enjoy fantasy stories"}};
    draft.draft.context[0].text="Maya 👩🏽‍💻";
    const request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
    const payload=JSON.parse(JSON.parse(request.body).messages[1].content[0].text);
    expect(payload.speaker).toMatchObject({role:"outgoing-speaker",profile:{familiarity:"I know this film"}});
    expect(payload.preferences.familiarity).toBe(familiarity||undefined);
    const plan=validateExpressVisualPlan({...result,familiarity:familiarity?"mixed":"unknown"},draft,request.review);
    expect(plan.familiarity).toBe(familiarity?"mixed":"unknown");
    if(!familiarity)expect(()=>validateExpressVisualPlan({...result,familiarity:"familiar"},draft,request.review)).toThrow();
    expect(JSON.parse(request.body).messages[0].content).toContain("names/skin tone/language");
  });
  it("preserves the final solved-alert/pilot state and chronological context when the review was reordered",async()=>{
    const messages=await localDemo("en","combined"),ids=messages.map((_,i)=>({id:`id-${i}`}));
    const draft={...offlineDraft(),intent:"A lighthearted reply agreeing to a small dashboard pilot while keeping the old links",creative:"",
      expression:{style:"auto" as const,intensity:"auto" as const,reference:""},
      context:messages.map((m,i)=>({label:ids[i].id,text:`${m.speaker}: ${m.text}`,included:true})).reverse()};
    const built=buildCreativeBrief(draft,ids),request=buildExpressVisualPlan({draft:built.draft},{samples:[],coverage:[]},config.profile!,config.executionScope!);
    const payload=JSON.parse(JSON.parse(request.body).messages[1].content[0].text);
    expect(payload.context.at(-1).text).toBe("Alex: Let's pilot dashboards; keep old links.");
    expect(payload.context[6].text).toContain("Both alerts are fixed");
    expect(JSON.parse(request.body).messages[0].content).toContain("LATEST state+intent, not resolved crises");
    const plan=validateExpressVisualPlan({...result,observedSources:[],visualStyle:"unknown",evidence:["c2"],reaction:"relieved",
      replyIntent:"Alerts are resolved; support a modest dashboard pilot while retaining old links",
      characters:["Samwise Gamgee","Frodo Baggins"],subjectCount:2,adaptedCaption:"One small step, with our old paths still open"}, {draft:built.draft},request.review);
    const outgoing=buildCreativeBrief(built.draft,ids,undefined,{treatment:"natural-photo",contextPlan:plan});
    expect(outgoing.prompt).toContain('"reaction":"relieved"');
    expect(outgoing.prompt).toContain('"subjectCount":2');
    expect(outgoing.prompt).toContain("CURRENT conversational state");
  });
  it("original mode cannot inherit a recognized franchise; an explicit unrelated subject stays original",()=>{
    const draft=input();draft.draft.intent="An original cat taking a break, no film";
    draft.draft.expression={style:"natural-photo",intensity:"auto",reference:"",culturalMode:"original"};
    const request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
    expect(()=>validateExpressVisualPlan(result,draft,request.review)).toThrow();
    const original=validateExpressVisualPlan({...result,mode:"override",kind:"motif",referenceChoice:"original",franchise:null,characters:[],subject:"cat"},draft,request.review);
    expect(original.franchise).toBeNull();
    draft.draft.expression={style:"natural-photo",intensity:"auto",reference:"Sherlock Holmes",culturalMode:"explicit"};
    const explicit=validateExpressVisualPlan({...result,referenceChoice:"explicit",mode:"override",franchise:null,characters:["Sherlock Holmes"]},draft,request.review);
    expect(explicit.characters).toEqual(["Sherlock Holmes"]);
  });
  it("accepts a realistic three-message text-only photographic request without fabricated source style",()=>{
    const draft=input();draft.draft.intent="An original photo of two cats celebrating";
    draft.draft.creative="";draft.draft.context=[{label:"1",text:"Maya: The checks failed",included:true},
      {label:"2",text:"Leo: Fixed now",included:true},{label:"3",text:"Alex: Thanks, let's take a break",included:true}];
    draft.draft.expression={style:"natural-photo",intensity:"auto",reference:""};
    const request=buildExpressVisualPlan(draft,{samples:[],coverage:[]},config.profile!,config.executionScope!);
    const plan=validateExpressVisualPlan({...result,referenceChoice:"original",observedSources:[],mode:"override",kind:"none",franchise:null,characters:[],
      subject:"cat",subjectCount:2,reaction:"celebrating",medium:"unknown",visualStyle:"unknown",certainty:"none",evidence:["intent","c3"]},draft,request.review);
    const body=buildCreativeBrief(draft.draft,draft.draft.context.map(c=>({id:c.label})),undefined,{treatment:"requested",contextPlan:plan});
    expect(body.prompt).toContain("photographic scene");expect(body.prompt).toContain('"subject":"cat"');
    for(const bad of [{...result,extra:"secret"}, {...plan,visualStyle:"photo"}, {...result,evidence:["c99"]}, {...result,adaptedCaption:"x".repeat(501)}]){
      expect(()=>validateExpressVisualPlan(bad,draft,request.review)).toThrow();
    }
  });
