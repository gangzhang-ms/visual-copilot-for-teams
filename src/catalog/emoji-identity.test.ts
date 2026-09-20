import {expect,it} from "vitest";
import {emojiIdentity} from "./emoji-identity";
import {emojiSequences,selectedEmoji} from "../shared/local-chat";
it("labels symbols locally without claiming intention or inferring a culture",()=>{
  expect(emojiIdentity("🙏","en").name).toBe("Folded hands");
  expect(emojiIdentity("🙏","zh-CN").name).toBe("合十的双手");
  expect(emojiIdentity("🙏","en").possibilities).toContain("thanks, a request, or prayer");
  expect(emojiIdentity("🙂","en").possibilities).toContain("sincerely friendly, restrained, or ironic");
  expect(emojiIdentity("🎉","en").possibilities).toBeUndefined();
});
it("keeps all graphemes and selectors exact while looking up names",()=>{
  const values=["🙏🏽","👩🏽‍💻","🇺🇳","1️⃣","❤️","👨‍👩‍👧‍👦","🏳️‍🌈","😮‍💨"];
  expect(emojiSequences("Text "+values.join("")+" end")).toEqual(values);
  expect(selectedEmoji(values.join(""))).toBe(values.join(" "));
  expect(emojiIdentity("🙏🏽","en").name).toBe("Folded hands · medium skin tone");
  expect(emojiIdentity("1️⃣","zh-CN").name).toBe("键帽：1");
  expect(emojiIdentity("❤️","en").codes).toBe("U+2764 U+FE0F");
  for(const value of values)expect(emojiIdentity(value,"zh-CN").known).toBe(true);
});
it("provides exact code points rather than inventing an unknown identity",()=>{
  const result=emojiIdentity("🫠","en");
  expect(result).toEqual({name:"Local name unavailable",known:false,codes:"U+1FAE0",possibilities:undefined});
  expect(emojiSequences("Plain text 123")).toEqual([]);
});
