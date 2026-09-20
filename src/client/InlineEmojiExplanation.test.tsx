import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {InlineEmojiExplanation,type InlineExplanationState} from "./InlineEmojiExplanation";
import type {Explanation} from "../shared/types";
const explanation:Explanation={background:{source:null,context:null,frames:[]},
  observations:[{text:"<script>visible fixture</script>",frames:["owned-frame"]}],commonUsage:["Fixture only"],
  contextualInterpretations:[{text:"Possible contextual fixture",context:["owned-context"]}],
  uncertainties:["Intent is uncertain"],safeResponseGuidance:["Ask kindly"]};
for(const language of ["en","zh-CN"] as const){
  for(const state of [{status:"idle"},{status:"pending"},{status:"cancelled"},
    {status:"error",message:"Safe failure message"},{status:"ready",explanation}] satisfies InlineExplanationState[]){
    it(`${language} renders the ${state.status} inline state without fabricated meaning`,()=>{
      const html=renderToStaticMarkup(<InlineEmojiExplanation language={language} analysis={{
        state,disabled:false,onExplain:()=>{},onCancel:()=>{}
      }}/>);
      expect(html.match(/<button\b/g)).toHaveLength(1);
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(`aria-busy="${state.status==="pending"}"`);
      if(state.status==="ready"){
        expect(html).toContain("&lt;script&gt;visible fixture&lt;/script&gt;");
        expect(html).toContain("Possible contextual fixture");expect(html).toContain("Intent is uncertain");
        expect(html).toContain("Fixture only");expect(html).not.toContain("inline-emoji-common");
        expect(html).not.toContain("<script>");
        for(const detail of ["owned-frame","owned-context","Intent is uncertain","Fixture only","&lt;script&gt;visible fixture"])
          expect(html.indexOf(detail)).toBeGreaterThan(html.indexOf('class="inline-explanation-details"'));
        expect(html).toContain('hidden=""');expect(html).toContain('aria-expanded="false"');
        expect(html).toContain(language==="en"?"Details":"详情");
      }else{
        expect(html).not.toContain("inline-emoji-result");
        if(state.status==="error")expect(html).toContain('role="alert"');
        if(state.status==="idle")expect(html).toContain(language==="en"?"Use AI to interpret this message":"使用 AI 结合对话");
      }
      expect(html).toContain(language==="en"?"not only the previewed symbol":"而非仅当前预览的符号");
    });
  }
}
