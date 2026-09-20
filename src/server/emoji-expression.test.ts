import {expect,it} from "vitest";
import {parseEmojiDraft,buildEmojiExpression,validateEmojiOptions} from "./emoji-expression";
import {validEmojiSequence,emojiInsertion,appendEmojiDraft,type EmojiExpressionDraft} from "../shared/emoji-expression";
import {selectedEmoji} from "../shared/local-chat";
import {loadLocalChatConfig} from "./local-chat-config";
const messages=[{id:"owned",speaker:"Maya",text:"Finally done 🙃👩🏽‍💻🇺🇳1️⃣❤️"}];
const draft=():EmojiExpressionDraft=>({intent:"Celebrate gently",language:"en",replyTo:"owned",
  context:[{label:"owned",text:messages[0].text,included:true}],
  preferences:{formality:"casual",familiarity:"",relationship:"",humor:"",avoid:""}});
const options=()=>({options:["👩🏽‍💻","🇺🇳","1️⃣"].map((emoji,i)=>({emojis:[emoji],label:`Option ${i}`,reason:"Fits the reply",caution:"Meaning depends on context",text:""}))});
it.each(["👩🏽‍💻","👨‍👩‍👧‍👦","🇺🇳","1️⃣","❤️","👍🏽","🏳️‍🌈","😮‍💨"])("preserves a complete Unicode grapheme %s",value=>{
  expect(validEmojiSequence(value)).toBe(true);expect(selectedEmoji(`prefix${value}suffix`)).toBe(value);
  expect(emojiInsertion({...options().options[0],emojis:[value]},false)).toBe(value);
});
it.each(["A","1","🇺","🏽","\uFE0F","👍🏽x","👍 🎉","👩‍x","<b>🙂</b>"])("rejects incomplete/non-emoji output %s",value=>{
  expect(validEmojiSequence(value)).toBe(false);
  const output=options();output.options[0].emojis=[value];expect(()=>validateEmojiOptions(output)).toThrow();
});
it("binds selected owned text and at most ten contexts without any image/search payload",()=>{
  const config=loadLocalChatConfig("OFFLINE",true),d=parseEmojiDraft(draft(),messages);
  const built=buildEmojiExpression(d,messages,config.profile!,config.executionScope!);
  const body=JSON.parse(built.body),payload=JSON.parse(body.messages[1].content[0].text);
  expect(body.messages[1].content).toHaveLength(1);expect(built.review.imageCount).toBe(0);
  expect(payload.replyTo).toEqual({context:"c1",text:messages[0].text,emoji:selectedEmoji(messages[0].text)});
  expect(body.response_format.json_schema.strict).toBe(true);
  expect(()=>parseEmojiDraft({...draft(),replyTo:"other-room"},messages)).toThrow();
  expect(()=>parseEmojiDraft({...draft(),context:[{label:"foreign",text:"x",included:true}]},messages)).toThrow();
  expect(()=>parseEmojiDraft({...draft(),context:[{label:"owned",text:"x",included:false}]},messages)).toThrow();
  expect(()=>parseEmojiDraft({...draft(),context:Array.from({length:11},(_,i)=>({label:String(i),text:"x",included:true})),replyTo:null},
    Array.from({length:11},(_,i)=>({id:String(i),speaker:"Maya",text:"x"})))).toThrow("local-context-limit");
});
it("rejects extra output fields, duplicate options, markup, oversized text and malformed counts",()=>{
  for(const output of [{...options(),url:"https://example.com"}, {options:options().options.slice(0,2)},
    {options:Array(3).fill(options().options[0])}]){
    expect(()=>validateEmojiOptions(output)).toThrow();
  }
  for(const text of ["<script>bad</script>","x".repeat(161),"\n"]){
    const output=options();output.options[0].text=text;expect(()=>validateEmojiOptions(output)).toThrow();
  }
});
it("insertion retains all emoji code units and existing typed content, never truncating on overflow",()=>{
  const option={...options().options[0],emojis:["👩🏽‍💻","🇺🇳","1️⃣"],text:"Well done"};
  expect(emojiInsertion(option,false)).toBe("👩🏽‍💻🇺🇳1️⃣");
  expect(appendEmojiDraft("Already typed",emojiInsertion(option,true))).toBe("Already typed Well done 👩🏽‍💻🇺🇳1️⃣");
  expect(()=>appendEmojiDraft("x".repeat(2000),"🙂")).toThrow("emoji-composer-limit");
});
it("does not reintroduce redacted reply text while preserving the server-owned emoji sequence",()=>{
  const config=loadLocalChatConfig("OFFLINE",true),owned=[{id:"owned",speaker:"Maya",text:"private detail 👩🏽‍💻"}];
  const d=parseEmojiDraft({...draft(),context:[{label:"owned",text:"Redacted 👩🏽‍💻",included:true}]},owned);
  const built=buildEmojiExpression(d,owned,config.profile!,config.executionScope!);
  expect(built.body).not.toContain("private detail");
  const payload=JSON.parse(JSON.parse(built.body).messages[1].content[0].text);
  expect(payload.replyTo).toEqual({context:"c1",text:"Redacted 👩🏽‍💻",emoji:"👩🏽‍💻"});
});
