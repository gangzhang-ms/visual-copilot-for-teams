import type {Language} from "./types";
export interface EmojiExpressionDraft {
  intent:string;language:Language;replyTo:string|null;
  context:{label:string;text:string;included:boolean}[];
  preferences:{formality:"unknown"|"formal"|"casual";familiarity:string;relationship:string;humor:string;avoid:string};
}
export interface EmojiOption {emojis:string[];label:string;reason:string;caution:string;text:string}
export interface EmojiSuggestions {id:string;digest:string;revision:number;expiresAt:number;replyTo:string|null;options:EmojiOption[]}
const rgi=new RegExp("^(?:\\p{RGI_Emoji})$","v");
export function validEmojiSequence(value:unknown):value is string{
  return typeof value==="string"&&value.length<=40&&rgi.test(value)&&!/^\p{Emoji_Modifier}$/u.test(value)
    &&[...new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(value)].length===1;
}
export function emojiInsertion(option:EmojiOption,withText:boolean){
  const emojis=option.emojis.join("");
  return withText&&option.text?`${option.text} ${emojis}`:emojis;
}
export function appendEmojiDraft(current:string,addition:string){
  const next=current+(current&&!/\s$/u.test(current)?" ":"")+addition;
  if(next.length>2000)throw new Error("emoji-composer-limit");
  return next;
}
