import {emojiCatalog} from "./emoji-catalog";
import type {Language} from "../shared/types";

// Small reviewed local labels, not a complete Unicode dictionary or a sender-intent classifier.
const labels:Partial<Record<string,readonly [string,string]>>={
  "👍":["Thumbs up","竖起拇指"],"🙌":["Raising hands","举起双手"],"🎉":["Party popper","派对礼花"],
  "😊":["Smiling face with smiling eyes","眉开眼笑"],"🙏":["Folded hands","合十的双手"],
  "👀":["Eyes","眼睛"],"💪":["Flexed biceps","弯曲的二头肌"],"🤔":["Thinking face","思考的脸"],
  "✅":["Check mark button","勾选按钮"],"❤️":["Red heart","红心"],"🙂":["Slightly smiling face","微笑的脸"],
  "🙃":["Upside-down face","倒置的脸"],"😮‍💨":["Face exhaling","呼气的脸"],
  "👩🏽‍💻":["Woman technologist: medium skin tone","女性技术人员：中等肤色"],
  "👨‍👩‍👧‍👦":["Family: man, woman, girl, boy","家庭：男人、女人、女孩、男孩"],
  "🇺🇳":["Flag: United Nations","旗帜：联合国"],"🏳️‍🌈":["Rainbow flag","彩虹旗"]
};
const tones:Record<string,readonly [string,string]>={
  "🏻":["light skin tone","浅肤色"],"🏼":["medium-light skin tone","中浅肤色"],
  "🏽":["medium skin tone","中等肤色"],"🏾":["medium-dark skin tone","中深肤色"],"🏿":["dark skin tone","深肤色"]
};
export function emojiIdentity(sequence:string,language:Language){
  const column=language==="en"?0:1,codes=Array.from(sequence,c=>`U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4,"0")}`).join(" ");
  let name=labels[sequence]?.[column];
  if(!name&&/^[0-9#*]\uFE0F?\u20E3$/u.test(sequence))name=language==="en"?`Keycap: ${sequence[0]}`:`键帽：${sequence[0]}`;
  const tone=Array.from(sequence).at(-1);
  if(!name&&tone&&tones[tone]){
    const base=sequence.slice(0,-tone.length),baseLabel=labels[base]?.[column];
    if(baseLabel)name=`${baseLabel} · ${tones[tone][column]}`;
  }
  if(!name&&language==="en")name=emojiCatalog.find(entry=>entry.emoji===sequence)?.altText;
  const base=sequence.replace(/\p{Emoji_Modifier}/gu,"");
  const possibilities=base==="🙏"?(language==="en"
    ?"May express thanks, a request, or prayer. The symbol alone does not tell you which."
    :"可能表达感谢、请求或祈祷；仅凭这个符号不能确定是哪一种。")
    :base==="🙂"?(language==="en"
      ?"May be sincerely friendly, restrained, or ironic depending on the exchange and shared usage."
      :"可能是真诚友好，也可能较为克制或带有反讽，取决于对话及双方的使用习惯。"):undefined;
  return {name:name??(language==="en"?"Local name unavailable":"暂无本地名称"),known:!!name,codes,possibilities};
}
