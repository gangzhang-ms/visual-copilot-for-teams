import type {Language} from "../shared/types";
import {EmojiEnlargement} from "./EmojiEnlargement";
import {InlineEmojiExplanation,type InlineEmojiAnalysis} from "./InlineEmojiExplanation";
import "./custom-emoji-artwork.css";
export function CustomEmojiArtwork({dataUrl,language,analysis}:{dataUrl:string;language:Language;analysis?:InlineEmojiAnalysis}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  return <div className="custom-emoji-artwork">
    <EmojiEnlargement count={1} language={language} trigger={({open,toggle,id})=>
      <button type="button" className="custom-emoji-trigger" aria-label={t("Toggle custom emoji preview","展开或收起自定义 emoji 预览")}
        aria-expanded={open} aria-controls={id} onClick={toggle}>
        <img className="custom-emoji-icon" src={dataUrl} alt={t("Original custom emoji image","原创自定义 emoji 图片")}/>
      </button>}>
      <img className="custom-emoji-preview" src={dataUrl} alt={t("Enlarged original custom emoji image","放大的原创自定义 emoji 图片")}/>
      {analysis&&<InlineEmojiExplanation analysis={analysis} language={language}/>}
    </EmojiEnlargement>
  </div>;
}
