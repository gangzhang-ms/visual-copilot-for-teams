import {describe,it,expect} from "vitest";
import {containsUnicodeEmoji,canExplainLocalMessage,selectedEmoji} from "./local-chat";
describe("local Explain eligibility",()=>{
  it("extracts whole emoji graphemes without turning surrounding sentences into the target",()=>{
    expect(selectedEmoji("Work is done 👩🏽‍💻 — thanks ❤️!")).toBe("👩🏽‍💻 ❤️");
    expect(selectedEmoji("Options 1️⃣ and 🇨🇳, family 👨‍👩‍👧‍👦")).toBe("1️⃣ 🇨🇳 👨‍👩‍👧‍👦");
    expect(selectedEmoji("Ordinary text 123 # * \u200d\ufe0f\u{1f3fd}")).toBe("");
  });
  it.each([
    "\u{1f642}","Hello \u{1f642}","\u{1f1e8}\u{1f1f3}","\u{1f44d}\u{1f3fd}",
    "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}","\u{1f469}\u{1f3fd}\u200d\u{1f4bb}",
    "\u2764\ufe0f","\u2665\ufe0f","1\ufe0f\u20e3","#\ufe0f\u20e3","*\u20e3",
    "\u{1f3f3}\ufe0f\u200d\u{1f308}"
  ])("accepts emoji sequence %s",text=>{
    expect(containsUnicodeEmoji(text)).toBe(true);
    expect(canExplainLocalMessage({id:"one",speaker:"Alex",text})).toBe(true);
  });
  it.each(["","plain text","普通文字","abc XYZ","12345","#","*","!?.,:;()",
    "\ufe0f","\ufe0e","\u200d","\u20e3","\u{1f3fb}","\u{1f3ff}","\u{1f1e8}",
    "\u200d\ufe0f\u{1f3fd}","Copyright \u00a9 2026; trademark \u2122"
  ])("rejects ordinary text or isolated components %s",text=>{
    expect(containsUnicodeEmoji(text)).toBe(false);
    expect(canExplainLocalMessage({id:"one",speaker:"Alex",text})).toBe(false);
  });
  it("retains attachment eligibility and does not infer it from ordinary text",()=>{
    expect(canExplainLocalMessage(undefined)).toBe(false);
    expect(canExplainLocalMessage({id:"one",speaker:"Alex",text:"caption",attachment:{category:"image",dataUrl:"data:image/png;base64,fixture"}})).toBe(true);
  });
});
