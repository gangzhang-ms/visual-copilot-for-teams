import {beforeAll,it,expect,vi} from "vitest";
import * as gateway from "./model-gateway";
import sharp from "sharp";
import {buildExpressVisualPlan,validateExpressVisualPlan} from "./express-visual-plan";
import {buildSearchQueryPlan} from "./image-search-query";
import {buildCreativeBrief} from "./local-generation";
import {buildSourceRanking,validateSourceRanking} from "./meme-source-ranking";
import {loadLocalChatConfig} from "./local-chat-config";
import {offlineDraft} from "./generation.test.support";
import type {MediaPreview} from "../shared/types";
import {digest} from "./analysis-session";
import {localDemo} from "./local-demo";
let visual:MediaPreview;
const config=loadLocalChatConfig("OFFLINE",true);
const input=()=>({draft:{...offlineDraft(),intent:"Work work",context:[{label:"incoming",text:"PRIVATE_PROJECT_771: one portal for all work",included:true}]}});
const result={observedSources:["Gandalf"],mode:"inherit",kind:"fictional",franchise:"The Lord of the Rings",characters:["Gandalf"],subject:"wizard",
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
it.each(["en","zh-CN"] as const)("fits the unchanged profile for the actual nine-message %s demo and two frames",async language=>{
  const messages=await localDemo(language,"combined"),draft=input();
  draft.draft.intent="Work work. Exhausted by endless tasks.";
  draft.draft.creative="";
  draft.draft.expression={style:"auto",intensity:"auto",reference:""};
  draft.draft.context=messages.map((m,i)=>({label:String(i),text:`${m.speaker}: ${m.text}`,included:true}));
  const source={samples:[...visual.samples,...visual.samples].map((s,i)=>({...s,assetId:String(i+1)})),coverage:[]};
  const original=gateway.preflight;
  const accounting=vi.spyOn(gateway,"preflight").mockImplementation((...args)=>{
    expect(args[3]+args[2].samples.length*args[1].imageTokenUpperBound+512).toBeLessThanOrEqual(8500);
    return original(...args);
  });
  try{
    const request=buildExpressVisualPlan(draft,source,config.profile!,config.executionScope!);
    expect(request.review.inputTokens).toBeLessThanOrEqual(8500);expect(request.review.imageCount).toBe(2);
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
it("explicit cat override removes incoming fictional names without losing reaction/count",()=>{
  const draft=input();draft.draft.intent="This time no movie: two cats, exhausted";
  const request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  const plan=validateExpressVisualPlan({...result,mode:"override",kind:"motif",franchise:null,characters:[],subject:"cat",
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
  const plan=validateExpressVisualPlan({...result,observedSources:[],mode:"unanchored",kind:"none",franchise:null,characters:[],subject:"person",
    certainty:"none",visualStyle:"unknown",medium:"unknown",evidence:[],motif:"An exhausted reaction"},draft,request.review);
  expect(request.review.imageCount).toBe(0);expect(plan.query).toContain("reaction meme");
  expect(()=>validateExpressVisualPlan(result,draft,request.review)).toThrow();
});
it("unknown faces retain a motif, not an actor guess or an unsupported title",()=>{
  const draft=input(),request=buildExpressVisualPlan(draft,visual,config.profile!,config.executionScope!);
  expect(request.body).toContain("NEVER identify real people/actors by face");
  const unknown={...result,observedSources:[null],kind:"motif",franchise:null,characters:[],subject:"person",certainty:"uncertain",motif:"A surprised look"};
  expect(validateExpressVisualPlan(unknown,draft,request.review).franchise).toBeNull();
  expect(()=>validateExpressVisualPlan({...unknown,franchise:"Invented Film"},draft,request.review)).toThrow();
  expect(()=>validateExpressVisualPlan({...unknown,observedSources:["Gandalf"]},draft,request.review)).toThrow();
  expect(()=>validateExpressVisualPlan({...unknown,mode:"unanchored",observedSources:["Gandalf"]},draft,request.review)).toThrow();
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
  const unknown=validateExpressVisualPlan({...result,observedSources:[null],kind:"motif",franchise:null,characters:[],
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
