import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {CustomEmojiArtwork} from "./CustomEmojiArtwork";
import {EmojiInspector} from "./EmojiInspector";

for(const language of ["en","zh-CN"] as const)it(`${language} shares the Unicode disclosure without a pill or modal`,()=>{
  const html=renderToStaticMarkup(<CustomEmojiArtwork dataUrl="data:image/png;base64,iVBORw0KGgo=" language={language}/>);
  expect(html.match(/<button\b/g)).toHaveLength(1);
  expect(html).toContain('aria-expanded="false"');
  const id=html.match(/aria-controls="([^"]+)"/)?.[1];
  expect(id).toBeTruthy();expect(html).toContain(`<details id="${id}"`);
  const summary=`<summary>${language==="en"?"Enlarge emoji (1)":"放大 emoji（1）"}</summary>`;
  expect(html).toContain(summary);
  expect(renderToStaticMarkup(<EmojiInspector text="👩🏽‍💻" language={language}/>)).toContain(summary);
  expect(html).toContain('class="custom-emoji-icon"');
  expect(html).not.toMatch(/<p\b|<dialog\b|custom-emoji-caption|custom-emoji-preview|Custom emoji · image|Unicode name|source pixels/);
});
it("keeps the exact multi-emoji selector and initial-open Unicode preview",()=>{
  const html=renderToStaticMarkup(<EmojiInspector text="🙏🙂" language="en" initialOpen/>);
  expect(html).toContain("<summary>Enlarge emoji (2)</summary>");
  expect(html).toContain('class="emoji-enlargement-panel"');
  expect(html).toContain('class="emoji-enlarged"');expect(html).toContain("🙏");expect(html).toContain("🙂");
  expect(html).not.toContain("emoji-possible-uses");expect(html).not.toContain("emoji-identity-caution");
});
