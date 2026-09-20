import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {emptyExpression,emptyCreativeDraft,sharedCreativeDraft,UnifiedExpression} from "./UnifiedExpression";
it.each(["en","zh-CN"] as const)("maps shared choices without changing state or sending image inputs in %s",language=>{
  const common={...emptyExpression(),intent:"  谢谢你 🙂  ",context:[{label:"owned",text:"x".repeat(2001),included:true,timestamp:""}],
    preferences:{formality:"casual" as const,familiarity:"Friends",relationship:"Team",humor:"Warm",avoid:"Sarcasm"}};
  const options={...emptyCreativeDraft(language),creative:"An original owl",output:"gif" as const};
  const before=structuredClone({common,options}),mapped=sharedCreativeDraft(options,common,language);
  expect(mapped).toMatchObject({intent:common.intent,creative:options.creative,output:"gif",preferences:{tone:"Casual",language,avoid:"Sarcasm",relationship:"Team"}});
  expect(mapped.context[0].text).toHaveLength(2001);
  expect(mapped).not.toHaveProperty("images");expect({common,options}).toEqual(before);
});
it.each(["en","zh-CN"] as const)("renders one primary intent and keyboard-native mode choices in %s",language=>{
  const html=renderToStaticMarkup(<UnifiedExpression value={emptyExpression()} creating={false} language={language} disabled={false} onChange={()=>{}} onMode={()=>{}} onReload={()=>{}}/>);
  expect(html.match(/<textarea/g)).toHaveLength(1);expect(html.match(/type="radio"/g)).toHaveLength(2);
  expect(html).toContain(language==="en"?"Find an existing image":"推荐现成图");
  expect(html).toContain(language==="en"?"Create a new image":"生成新图");
  expect(html).not.toContain("<pre");
});
it.each(["en","zh-CN"] as const)("starts creation with neutral choices, one description and a character-name hint in %s",language=>{
  const options=emptyCreativeDraft(language);
  expect(options).toMatchObject({creative:"",expression:{style:"auto",intensity:"auto",reference:""}});
  const html=renderToStaticMarkup(<UnifiedExpression value={emptyExpression()} creating language={language} disabled={false} onChange={()=>{}} onMode={()=>{}} onReload={()=>{}}/>);
  expect(html.match(/<textarea/g)).toHaveLength(1);
  expect(html).toContain(language==="en"?"Sherlock Holmes":"福尔摩斯");
  expect(html).not.toContain("studio-preferences");
});
