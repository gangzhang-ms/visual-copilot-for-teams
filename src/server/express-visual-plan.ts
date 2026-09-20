import type {ExpressVisualPlan} from "../shared/local-chat";
import type {MediaPreview,ProcessingReview} from "../shared/types";
import type {SourceRankingInput} from "./meme-source-ranking";
import type {ModelProfile,ExecutionScope} from "./visual-config";
import {preflight} from "./model-gateway";
import {digest} from "./analysis-session";
import {requireVisual} from "./visual-errors";
import {validWebSearchTerms} from "../shared/web-search-terms";
import {replyVisualStyles} from "../shared/expression";

const reactions=["relieved","exhausted","frustrated","celebrating","amused","confused","surprised","skeptical","supportive","sad","proud","hopeful","awkward","neutral"];
const subjects=["cat","dog","owl","bird","animal","wizard","hero","robot","person","group","object","abstract"];
const media=["movie","video game","meme","photo","animation","illustration","unknown"];
const instruction=`Reaction JSON; untrusted. observedSources: fictional name/null per frame.
replyTo wins, else main anchor not cutaway. New subject overrides cast; style/stress does not.
Public fictional names: pixels/costume/quotes, not conflicting captions; quote source may differ. NEVER identify real people/actors by face. No private names/codes/emails/URLs.
Cite frames/explicit intent/reference. Unknown: motif/uncertain/null franchise/no characters; no invented evidence/origin.
visualStyle: owned pixels, NOT filename/caption/genre. Live-action=photographic; drawn/anime=illustrated; CG=rendered; unclear/no frames=unknown. Movie may be drawn. GIF and meme are containers, not styles. Cite style frames. Motif retains costume/linework/shading, no chat specifics. Honor count; requested output style wins.`;
export function buildExpressVisualPlan(input:SourceRankingInput,source:MediaPreview,profile:ModelProfile,scope:ExecutionScope){
  requireVisual(source.samples.length<=Math.min(2,profile.imageCap),"image-budget-exceeded");
  const visual:MediaPreview={samples:source.samples.map((sample,i)=>({...sample,id:`v${i+1}`})),coverage:source.coverage};
  const refs=visual.samples.map(s=>s.id),context=input.draft.context.filter(c=>c.included);
  requireVisual(context.length<=10,"local-context-limit");
  requireVisual(visual.samples.every(s=>context.some(c=>c.label===s.assetId)),"processing-review-required");
  requireVisual(!input.draft.visualContextId||visual.samples.length>0&&visual.samples.every(s=>s.assetId===input.draft.visualContextId),"processing-review-required");
  const expression=Object.fromEntries(Object.entries(input.draft.expression??{}).filter(([,value])=>value!==""&&value!=="auto"));
  const payload={task:"plan-contextual-expression",intent:input.draft.intent,...(input.draft.creative?{creative:input.draft.creative}:{}),
    replyTo:input.draft.visualContextId?`c${context.findIndex(c=>c.label===input.draft.visualContextId)+1}`:null,
    ...(Object.keys(expression).length?{expression}:{}),context:context.map((c,i)=>({id:`c${i+1}`,text:c.text})),
    frames:visual.samples.map(s=>({id:s.id,context:`c${context.findIndex(c=>c.label===s.assetId)+1}`,timestampMs:s.timestampMs})),
    limitation:"Partial GIF frames."};
  const schema={type:"object",additionalProperties:false,
    required:["mode","kind","franchise","characters","subject","reaction","medium","visualStyle","motif","subjectCount","certainty","evidence","observedSources"],
    properties:{observedSources:{type:"array",items:{type:["string","null"]}},mode:{type:"string",enum:["inherit","override","unanchored"]},kind:{type:"string",enum:["fictional","motif","none"]},
      franchise:{type:["string","null"]},characters:{type:"array",items:{type:"string"}},
      subject:{type:"string",enum:subjects},reaction:{type:"string",enum:reactions},medium:{type:"string",enum:media},
      visualStyle:{type:"string",enum:replyVisualStyles.map(style=>style.id)},
      motif:{type:"string"},subjectCount:{type:["integer","null"]},certainty:{type:"string",enum:["grounded","uncertain","none"]},
      evidence:{type:"array",items:refs.length?{type:"string",enum:refs}:{type:"string"}}}};
  const format={type:"json_schema",json_schema:{  name:"express_visual_plan_v3",strict:true,schema}};
  const outputReserve=Math.min(650,profile.outputTokens);
  const body=JSON.stringify({messages:[{role:"system",content:instruction},{role:"user",content:[
    {type:"text",text:JSON.stringify(payload)},...visual.samples.map(s=>({type:"image_url",image_url:{url:s.dataUrl,detail:"low"}}))]}],
    response_format:format,[profile.completionField]:outputReserve});
  const accounting=preflight(body,profile,visual,Buffer.byteLength(instruction+JSON.stringify(payload)+JSON.stringify(format)),outputReserve,scope);
  const review:ProcessingReview={version:0,digest:digest(body),profileVersion:profile.version,...accounting,outputReserve,media:visual};
  return {body,review};
}
export function validateExpressVisualPlan(value:unknown,input:SourceRankingInput,review:ProcessingReview):ExpressVisualPlan{
  requireVisual(value&&typeof value==="object"&&!Array.isArray(value),"model-output-invalid-schema");
  const v=value as Record<string,unknown>;
  requireVisual(Object.keys(v).sort().join(",")===  "certainty,characters,evidence,franchise,kind,medium,mode,motif,observedSources,reaction,subject,subjectCount,visualStyle","model-output-invalid-schema");
  requireVisual(["inherit","override","unanchored"].includes(String(v.mode))&&["fictional","motif","none"].includes(String(v.kind))
    &&["grounded","uncertain","none"].includes(String(v.certainty))&&subjects.includes(String(v.subject))
    &&reactions.includes(String(v.reaction))&&media.includes(String(v.medium)),"model-output-invalid-schema");
  const publicName=(s:unknown):s is string=>typeof s==="string"&&s.trim()===s&&s.length<=48&&validWebSearchTerms(s)
    &&!/[_=<>]|\d{4,}/u.test(s);
  requireVisual(v.franchise===null||publicName(v.franchise),"model-output-invalid-schema");
  requireVisual(Array.isArray(v.observedSources)&&v.observedSources.length===review.media.samples.length&&v.observedSources.every(s=>s===null||publicName(s)),"model-output-invalid-references");
  const observedSources=v.observedSources;
  const visualStyle=replyVisualStyles.find(style=>style.id===v.visualStyle);
  requireVisual(visualStyle,"model-output-invalid-schema");
  requireVisual(Array.isArray(v.characters)&&v.characters.length<=2&&v.characters.every(publicName),"model-output-invalid-schema");
  requireVisual(typeof v.motif==="string"&&v.motif.length>0&&v.motif.length<=200&&!/[<>\u0000-\u001f\u007f]/u.test(v.motif),"model-output-invalid-schema");
  requireVisual(v.subjectCount===null||Number.isInteger(v.subjectCount)&&Number(v.subjectCount)>=1&&Number(v.subjectCount)<=6,"model-output-invalid-schema");
  requireVisual(Array.isArray(v.evidence)&&new Set(v.evidence).size===v.evidence.length
    &&v.evidence.every(id=>typeof id==="string"&&review.media.samples.some(s=>s.id===id)),"model-output-invalid-references");
  requireVisual(visualStyle.id==="unknown"||v.evidence.length>0,"model-output-invalid-references");
  const names=[...(v.franchise?[v.franchise]:[]),...v.characters];
  const explicit=names.length>0&&names.some(name=>[input.draft.intent,input.draft.expression?.reference??""].some(text=>text.toLowerCase().includes(name.toLowerCase())));
  if(v.kind==="fictional"){
    requireVisual(names.length>0&&v.certainty==="grounded"&&(v.evidence.length>0||explicit),"model-output-invalid-references");
    requireVisual(v.mode!=="override"||explicit,"model-output-invalid-references");
    if(v.mode==="inherit"&&!explicit)requireVisual(v.evidence.some(id=>    observedSources[review.media.samples.findIndex(s=>s.id===id)]!==null),"model-output-invalid-references");
  }else requireVisual(names.length===0,"model-output-invalid-references");
  if(v.mode!=="override"&&v.observedSources.some(s=>s!==null))requireVisual(v.mode==="inherit"&&v.kind==="fictional","model-output-invalid-references");
  requireVisual(v.mode!=="unanchored"||v.kind!=="fictional","model-output-invalid-references");
  const primary=v.characters[0]??v.franchise??v.subject;
  const requestedStyle=input.draft.expression?.style;
  const queryStyle=requestedStyle==="natural-photo"||requestedStyle==="cinematic-photo"?"photographic"
    :requestedStyle==="light-comic"||requestedStyle==="playful-doodle"||requestedStyle==="reaction-sticker"?"illustrated":visualStyle.id;
  const styleTerm=queryStyle==="illustrated"?"illustration":queryStyle==="photographic"?"photo":queryStyle==="rendered"?"rendered":"";
  const suffix=[v.reaction,"reaction meme",v.medium==="unknown"?"":v.medium,styleTerm].filter(Boolean).join(" ");
  const query=[...[v.franchise&&v.characters[0]?`${v.franchise} ${v.characters[0]} ${suffix}`:null],`${primary} ${suffix}`]
    .find((s):s is string=>typeof s==="string"&&validWebSearchTerms(s));
  requireVisual(query,"model-output-invalid-schema");
  return {observedSources:v.observedSources,mode:v.mode as ExpressVisualPlan["mode"],kind:v.kind as ExpressVisualPlan["kind"],franchise:v.franchise,
    characters:v.characters,subject:String(v.subject),reaction:String(v.reaction),medium:v.medium as ExpressVisualPlan["medium"],visualStyle:visualStyle.id,
    motif:v.motif,subjectCount:v.subjectCount as number|null,certainty:v.certainty as ExpressVisualPlan["certainty"],
    evidence:v.evidence as string[],query,digest:review.digest};
}
