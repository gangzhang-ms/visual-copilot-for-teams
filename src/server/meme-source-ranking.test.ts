import {expect,it} from "vitest";
import {buildSourceRanking,validateSourceRanking} from "./meme-source-ranking";
import {parseTemplates} from "./internet-memes";
import {offlineDraft} from "./generation.test.support";
import {loadLocalChatConfig} from "./local-chat-config";
const templates=parseTemplates({success:true,data:{memes:Array.from({length:20},(_,i)=>({
  id:String(1000+i),name:i===19?"Epic Handshake":`Catalog ${i}`,url:`https://i.imgflip.com/a${i}.jpg`,width:300,height:300,box_count:2
}))}},100);
it.each(["Couldn't have pulled that off on my own.","这次没你们真不行。"])("reviews semantic selection with exact intent and ten included contexts: %s",intent=>{
  const config=loadLocalChatConfig("OFFLINE-SEMANTIC",true),draft={...offlineDraft(),intent,
    context:Array.from({length:12},(_,i)=>({label:String(i),text:i<10?`Colleague ${i}`:"EXCLUDED-SENTINEL",included:i<10}))};
  const request=buildSourceRanking({draft,speakerContext:{role:"outgoing-speaker",source:"voluntary-local-report",profile:null}},templates,config.profile!,config.executionScope!);
  const body=JSON.parse(request.body),payload=JSON.parse(body.messages[1].content[0].text);
  expect(payload.intent).toBe(intent);expect(payload.context).toHaveLength(10);expect(payload.catalog).toHaveLength(20);
  expect(payload.speakerContext).toMatchObject({role:"outgoing-speaker",profile:null});
  expect(request.body).not.toContain("EXCLUDED-SENTINEL");expect(request.body).not.toContain("https://i.imgflip.com");
  expect(body.messages[1].content).toHaveLength(1);expect(request.review.imageCount).toBe(0);
  expect(body.response_format.json_schema).toMatchObject({name:"existing_template_selection_v1",strict:true});
  expect(body.response_format.json_schema.schema.properties.id.enum).toEqual([null,...templates.map(t=>t.id)]);
  expect(validateSourceRanking({id:"1019",reason:"Shared effort fits this expression."},templates)).toBe(templates[19]);
});
it("requires an explicit null for no match and rejects foreign IDs, malformed and extra fields",()=>{
  expect(validateSourceRanking({id:null,reason:"No suitable expression in this catalog."},templates)).toBeUndefined();
  for(const value of [{id:"9999",reason:"invented"},{id:"1000"},{id:"1000",reason:"ok",url:"https://example.invalid"}, {id:3,reason:"bad"}, {id:null,reason:"x".repeat(301)}])
    expect(()=>validateSourceRanking(value,templates)).toThrow();
});
it("enforces context, token and byte budgets instead of truncating reviewed text",()=>{
  const config=loadLocalChatConfig("OFFLINE-SEMANTIC",true);
  const context=Array.from({length:11},(_,i)=>({label:String(i),text:"hello",included:true}));
  expect(()=>buildSourceRanking({draft:{...offlineDraft(),context}},templates,config.profile!,config.executionScope!)).toThrow("local-context-limit");
  expect(()=>buildSourceRanking({draft:{...offlineDraft(),context:context.slice(0,10).map(c=>({...c,text:"x".repeat(2000)}))}},templates,config.profile!,config.executionScope!)).toThrow();
});
it("fits a full hundred-entry metadata catalog and ten short contexts within the existing conservative profile",()=>{
  const config=loadLocalChatConfig("OFFLINE-SEMANTIC",true);
  const pool=Array.from({length:100},(_,i)=>({...templates[0],id:String(2000+i),name:`Public template ${i}`}));
  const context=Array.from({length:10},(_,i)=>({label:String(i),text:`Colleague ${i}: Glad that worked out.`,included:true}));
  const result=buildSourceRanking({draft:{...offlineDraft(),context}},pool,config.profile!,config.executionScope!);
  const payload=JSON.parse(JSON.parse(result.body).messages[1].content[0].text);
  expect(payload.catalog).toHaveLength(100);expect(payload.context).toHaveLength(10);
  expect(result.review.inputTokens).toBeLessThanOrEqual(12000);
});
