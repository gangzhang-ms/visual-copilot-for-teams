import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {ExplanationPanel} from "./ExplanationPanel";
import type {Explanation} from "../shared/types";

it.each(["en","zh-CN"] as const)("keeps the brief compact and preserves all prose and references in closed details in %s",language=>{
  const value:Explanation={
    background:{source:null,context:null,frames:[]},
    observations:[{text:"The owl holds a cup (possibly tea).",frames:["asset-1-frame-0","asset-1-frame-11"]}],
    commonUsage:["Meme about control or unification.", "Possible relief."],
    contextualInterpretations:[{text:"It may express relief after the fix.",context:["A".repeat(43),"B".repeat(43),"C".repeat(43),"D".repeat(43),"E".repeat(43)]}],
    uncertainties:["Sender intent is unknown."],safeResponseGuidance:["Ask whether everything works."]
  };
  const before=structuredClone(value),html=renderToStaticMarkup(<ExplanationPanel value={value} language={language}/>);
  for(const ref of [...value.observations[0].frames,...value.contextualInterpretations[0].context])
    expect(html.indexOf(ref)).toBeGreaterThan(html.indexOf("<details"));
  for(const text of [value.observations[0].text,value.contextualInterpretations[0].text,...value.commonUsage,...value.uncertainties,...value.safeResponseGuidance])
    expect(html).toContain(text);
  expect(html.match(/<h2>/g)).toHaveLength(1);
  expect(html.match(/<p /g)).toHaveLength(2);
  expect(html).toContain(language==="en"?"Background: ":"背景：");
  expect(html).toContain(language==="en"?"Possible meaning here: ":"此处可能含义：");
  const unknown=language==="en"?"The source cannot be identified confidently from the selected visual.":"无法从所选图片或表情可靠识别出处。";
  expect(html.indexOf(unknown)).toBeGreaterThan(html.indexOf("<details"));
  expect(html.indexOf(unknown)).toBeGreaterThan(html.indexOf(value.contextualInterpretations[0].text));
  expect(html.indexOf(value.commonUsage[0])).toBeGreaterThan(html.indexOf("<details"));
  expect(html.split(unknown)).toHaveLength(2);
  expect(html).toContain(language==="en"?"Possible meaning":"可能的含义");
  expect(html).toContain(language==="en"?"Details":"详情");
  expect(html).not.toMatch(/<details[^>]* open/);
  expect(html.match(/<h3>/g)).toHaveLength(5);
  expect(html.indexOf("<p ")).toBeLessThan(html.indexOf("<details"));
  expect(html.indexOf("<h3>")).toBeGreaterThan(html.indexOf("<details"));
  expect(value).toEqual(before);
  const known={...value,background:{source:"Alice in Wonderland",context:"An encounter in a strange world.",frames:["asset-1-frame-0"]}};
  const recognized=renderToStaticMarkup(<ExplanationPanel value={known} language={language}/>);
  expect(recognized.indexOf("Alice in Wonderland")).toBeLessThan(recognized.indexOf("<details"));
  expect(recognized.indexOf("An encounter in a strange world.")).toBeGreaterThan(recognized.indexOf("<details"));
  expect(recognized).not.toContain(unknown);
});
