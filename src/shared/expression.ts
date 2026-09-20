export interface SpeakerProfile {
  language:"unknown"|"en"|"zh-CN"; culture:string; familiarity:string; tone:string; humor:string; avoid:string;
}
export interface SpeakerContext {
  role:"selected-sender"|"outgoing-speaker";
  source:"voluntary-local-report";
  profile:SpeakerProfile|null;
}
export const emptySpeakerProfile=():SpeakerProfile=>({language:"unknown",culture:"",familiarity:"",tone:"",humor:"",avoid:""});
export function validSpeakerProfile(value:unknown):value is SpeakerProfile{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const p=value as Record<string,unknown>;
  return Object.keys(p).sort().join(",")==="avoid,culture,familiarity,humor,language,tone"
    &&["unknown","en","zh-CN"].includes(String(p.language))
    &&["culture","familiarity","tone","humor","avoid"].every(k=>typeof p[k]==="string"&&p[k].length<=200&&!/[\u0000-\u001f\u007f]/.test(p[k]));
}
export function validSpeakerContext(value:unknown):value is SpeakerContext{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const c=value as Record<string,unknown>;
  return Object.keys(c).sort().join(",")==="profile,role,source"&&["selected-sender","outgoing-speaker"].includes(String(c.role))
    &&c.source==="voluntary-local-report"&&(c.profile===null||validSpeakerProfile(c.profile));
}
export const expressionStyles=[
  {id:"auto",en:"Follow description",zh:"跟随描述",direction:"Follow the requested scene and medium. Do not impose a stock animal, doodle, palette or subject count."},
  {id:"natural-photo",en:"Natural photo style",zh:"自然照片风",direction:"An original fictional photographic scene: candid framing, believable ambient light, natural skin/fabric/material textures, subtle imperfections and restrained color. Avoid sticker outlines, comic linework, cel shading, glossy plastic and 3D mascot rendering unless explicitly requested. Not a record of a real event."},
  {id:"cinematic-photo",en:"Cinematic photo style",zh:"电影照片风",direction:"An original fictional photographic scene with cinematic camera framing, motivated directional light, realistic material textures, subtle film grain and measured depth of field. A believable staged film-photo look, not a cartoon, illustration, plastic render or copied movie frame. Not a record of a real event."},
  {id:"reaction-sticker",en:"Reaction sticker",zh:"聊天反应贴纸",direction:"An original expressive reaction sticker: preserve the requested subjects, with readable expressions and purposeful gestures, confident clean outlines and a plain unobtrusive background."},
  {id:"light-comic",en:"Light meme / comic",zh:"轻梗漫画",direction:"An original single-panel reaction comic: one clear situation and visual punchline, expressive body language, sparse setting. No multi-panel poster or borrowed meme screenshot."},
  {id:"playful-doodle",en:"Playful doodle",zh:"松弛涂鸦",direction:"An original loose hand-drawn reaction doodle with a consistent line weight, legible silhouette and lively but anatomically coherent gesture. Deliberate drawing, not random scribbles."},
  {id:"deadpan-animal",en:"Deadpan cute animal",zh:"淡定小动物",direction:"An original cute animal reaction with dry understated expression and one recognizable gesture. Choose a species suited to the scene, not the same default animal for every request. Coherent paws and eyes; no branded mascot."}
] as const;
export type ExpressionStyle=typeof expressionStyles[number]["id"];
export const replyVisualStyles=[
  {id:"photographic",en:"Live-action / photographic",zh:"真人实拍／照片风",
    direction:"Match the selected visual's live-action/photographic look: realistic materials, lighting and camera framing. Retain the grounded fictional costume or visible motif and requested emotion. Do not default to cartoon outlines, illustration or mascot rendering."},
  {id:"illustrated",en:"Drawn / illustrated",zh:"绘制／插画风",
    direction:"Match the selected visual's drawn, illustrated or anime look. Retain its linework, palette and shading described in contextDirection.motif. Do not default to live-action photography or a different illustration style."},
  {id:"rendered",en:"Rendered / game visual",zh:"渲染／游戏画面",
    direction:"Match the selected visual's rendered/game appearance and the material, lighting and design cues in contextDirection.motif. Do not convert it to an unrelated cartoon or live-action photograph."},
  {id:"unknown",en:"Visual style uncertain",zh:"视觉风格不确定",
    direction:"Visual style is uncertain. Do not claim a matched medium or invent a film identity. Follow explicit requested medium; otherwise retain the cautious visible motif without imposing movie, cartoon or mascot styling."}
] as const;
export type ReplyVisualStyle=typeof replyVisualStyles[number]["id"];
export interface ExpressionOptions {style:ExpressionStyle;intensity:"auto"|"restrained"|"balanced"|"exaggerated";reference:string}
