import {expect,it} from "vitest";
import {LOCAL_CONTEXT_LIMIT,LOCAL_CONTEXT_REVIEW_LIMIT,localContextWithinLimit,selectLocalContextMessages} from "./local-context";
import {buildCreativeBrief} from "../server/local-generation";
import {offlineDraft} from "../server/generation.test.support";

const messages=Array.from({length:14},(_,i)=>({id:String(i),text:`Original ${i}`}));
it("selects the latest ten without changing any room messages",()=>{
  const before=structuredClone(messages);
  expect(LOCAL_CONTEXT_LIMIT).toBe(10);
  expect(selectLocalContextMessages(messages)).toEqual(messages.slice(4));
  expect(selectLocalContextMessages(messages,"12")).toEqual(messages.slice(4));
  expect(messages).toEqual(before);
});
it("includes an older selected target and the latest nine, keeping small rooms intact",()=>{
  expect(selectLocalContextMessages(messages,"0")).toEqual([messages[0],...messages.slice(5)]);
  expect(selectLocalContextMessages(messages.slice(0,3),"0")).toEqual(messages.slice(0,3));
});
it("counts included rows only, while the existing editable envelope stays bounded",()=>{
  expect(LOCAL_CONTEXT_REVIEW_LIMIT).toBe(12);
  const context=messages.slice(0,12).map((m,i)=>({label:m.id,text:m.text,included:i<10}));
  expect(localContextWithinLimit(context)).toBe(true);
  const result=buildCreativeBrief({...offlineDraft(),context},messages);
  const sent=JSON.parse(result.prompt.split("\n").at(-1)!);
  expect(sent.context).toHaveLength(10);
  expect(result.draft.context).toEqual(context);
  expect(()=>buildCreativeBrief({...offlineDraft(),context:context.map((c,i)=>({...c,included:i<11}))},messages)).toThrow("local-context-limit");
  expect(()=>buildCreativeBrief({...offlineDraft(),context:[...context,{label:"12",text:"Excluded",included:false}]},messages)).toThrow();
});
