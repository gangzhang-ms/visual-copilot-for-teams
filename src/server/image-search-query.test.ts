import {it,expect} from "vitest";
import {buildSearchQueryPlan,validateSearchQueryPlan} from "./image-search-query";
import {offlineDraft} from "./generation.test.support";
import {loadLocalChatConfig} from "./local-chat-config";
import {ModelGateway} from "./model-gateway";
const plan={emotion:"relieved",situation:"reaction",medium:"movie",publicReference:null};
it("executes the structured planner through the actual authorized ModelGateway",async()=>{
  const input={draft:{...offlineDraft(),intent:"Finally relieved"}};
  const config=loadLocalChatConfig("OFFLINE",true),built=buildSearchQueryPlan(input,config.profile!,config.executionScope??"production");
  config.localRequestDigests=new Set([built.review.digest]);
  let calls=0;
  const gateway=new ModelGateway(config,async(_url,init)=>{
    calls++;expect(JSON.parse(JSON.parse(String(init?.body)).messages[1].content[0].text).context).toEqual([]);
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(plan)}}]});
  });
  const result=await gateway.run(built.body,built.review,new AbortController().signal);
  expect(validateSearchQueryPlan(result,input)).toBe("relieved reaction movie");expect(calls).toBe(1);
});
it.each(["上线成功，终于松口气","The launch worked; finally relieved"])("binds a semantic structured request for %s without sending context/profile",intent=>{
  const input={draft:{...offlineDraft(),intent,context:[{label:"private",text:"PRIVATE-CONTEXT",included:true}],preferences:{...offlineDraft().preferences,culture:"PRIVATE-PROFILE"}}};
  const config=loadLocalChatConfig("OFFLINE",true),built=buildSearchQueryPlan(input,config.profile!,config.executionScope??"production");
  const body=JSON.parse(built.body);expect(body.response_format.json_schema.strict).toBe(true);
  expect(body.response_format.json_schema.schema.properties.publicReference).toEqual({type:"null"});
  expect(built.body).toContain(intent);expect(built.body).not.toMatch(/PRIVATE-CONTEXT|PRIVATE-PROFILE/);
  expect(validateSearchQueryPlan(plan,input)).toBe("relieved reaction movie");
  expect(built.review.digest).toBeTruthy();
});
it("allows exact publicly opted-in movie/character names, never invented names",()=>{
  const input={draft:{...offlineDraft(),intent:"Gandalf is relieved",allowPublicSearchReferences:true}};
  expect(validateSearchQueryPlan({...plan,publicReference:"Gandalf"},input)).toBe("Gandalf relieved reaction movie");
  expect(()=>validateSearchQueryPlan({...plan,publicReference:"Batman"},input)).toThrow();
  expect(()=>validateSearchQueryPlan({...plan,publicReference:"Gandalf"},{draft:{...input.draft,allowPublicSearchReferences:false}})).toThrow();
});
it("does not allow arbitrary free-form identifiers or unsafe plans",()=>{
  const input={draft:{...offlineDraft(),intent:"PRIVATE_CODE 12345678 user@example.com",allowPublicSearchReferences:true}};
  for(const publicReference of ["PRIVATE_CODE","12345678","user@example.com"]){
    expect(()=>validateSearchQueryPlan({...plan,publicReference},input)).toThrow();
  }
  expect(()=>validateSearchQueryPlan({...plan,emotion:"PRIVATE_CODE"},input)).toThrow();
  expect(()=>validateSearchQueryPlan({...plan,query:"raw private intent"},input)).toThrow();
});
