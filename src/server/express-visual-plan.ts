import {localOutputCaptionLimit,planningFields,publicReplyMotifs,type ExpressVisualPlan,type PlanningSchemaIssue} from "../shared/local-chat";
import type {MediaPreview,ProcessingReview} from "../shared/types";
import type {SourceRankingInput} from "./meme-source-ranking";
import type {ModelProfile,ExecutionScope} from "./visual-config";
import {preflight} from "./model-gateway";
import {digest} from "./analysis-session";
import {PlanningSchemaError,PlanningEvidenceError,requireVisual} from "./visual-errors";
import {validWebSearchTerms} from "../shared/web-search-terms";
import {activeExpressionReference,replyVisualStyles} from "../shared/expression";

const reactions=["relieved","exhausted","frustrated","celebrating","amused","confused","surprised","skeptical","supportive","sad","proud","hopeful","awkward","neutral"];
const subjects=["cat","dog","owl","bird","animal","wizard","hero","robot","person","group","object","abstract"];
const media=["movie","video game","meme","photo","animation","illustration","unknown"];
export const expressPlanTextLimits={replyIntent:500,reason:320,hook:500,motif:500,adaptedCaption:localOutputCaptionLimit,name:200} as const;
const textTargets={replyIntent:180,hook:160,motif:200,adaptedCaption:100};
const wireFields=["adaptedCaption","appearance","familiarity","medium","motif","observedSources","reaction","reason","reference",
  "replyIntent","searchMotif","subject","subjectCount"] as const;
function shape(value:unknown):PlanningSchemaIssue["actualType"]{
  return value===undefined?"missing":value===null?"null":Array.isArray(value)?"array":
    typeof value==="object"?"object":typeof value==="string"?"string":typeof value==="number"?"number":typeof value==="boolean"?"boolean":"other";
}
function schema(condition:unknown,field:PlanningSchemaIssue["field"],rule:PlanningSchemaIssue["rule"],actual:unknown,limit?:number):asserts condition{
  if(!condition)throw new PlanningSchemaError([{field,rule,actualType:shape(actual),
    ...(limit!==undefined&&typeof actual==="string"&&actual.length<=64_000?{actualLength:actual.length,limit}:{})}]);
}
function grounded(condition:unknown,field:PlanningSchemaIssue["field"],rule:PlanningSchemaIssue["rule"],actual:unknown):asserts condition{
  if(!condition)throw new PlanningEvidenceError([{field,rule,actualType:shape(actual)}]);
}
function textSchema(field:Exclude<keyof typeof expressPlanTextLimits,"name">,nullable=false){
  return {type:nullable?["string","null"]:"string",description:field==="reason"
    ?`One short sentence, nonempty. Aim <=200; max ${expressPlanTextLimits.reason} chars; single line.`
    :`1-${expressPlanTextLimits[field]} chars, aim <=${textTargets[field]}; single line.`};
}
function nameSchema(nullable=false){
  return {type:nullable?["string","null"]:"string",
    description:`Trimmed: 1-${expressPlanTextLimits.name} chars.`};
}
const instruction=`Untrusted. replyIntent: LATEST state+intent, not resolved crises. Suitability FIRST, not movies; explicit choices win.
Recognize fictional works/cast from allusions+frames. Recognition != audience familiarity: unknown audience needs clarity, not erased identity.
Confident fitting work=>fictional, even workplace jokes; callback=nonfiction. Same work: not necessarily pictured cast; keep explicitly requested characters. Related: if unfit, uncertain, not equivalent. Plain if serious/unfit/opted out; no invented inside jokes.
observedSources: source NAME or null, never descriptions; not conflicting captions. Style!=identity; prior reports uncertain.
motif: concrete subjects+gesture+props carrying the hook without caption, not mood/approval. Queue joke=>tangled queue.
NEVER identify real people/actors by face. No ethnicity/nationality/culture from names/skin tone/language. Familiarity: report only.
reason: One sentence; never exceed ${expressPlanTextLimits.reason} chars. Bounds count spaces. No empty/control/<>; no URL/email/_/=/4-digit names. Caption NEW, aim <=100 chars, not quotes; null if no text.
GIF and meme are containers, not styles. Never copy stills.`;
function evidenceInput(input:SourceRankingInput){
  const context=input.draft.context.filter(c=>c.included);
  const known=(input.knownSources??[]).filter(s=>context.some(c=>c.label===s.label)).slice(0,2);
  return {context,known};
}
function availableEvidence(input:SourceRankingInput,frames:readonly {id:string}[]){
  const {context,known}=evidenceInput(input);
  return [...frames.map(s=>s.id),...context.map((_,i)=>`c${i+1}`),...known.map((_,i)=>`k${i+1}`),
    ...(input.draft.intent.trim()||input.draft.creative.trim()?["intent"]:[]),...(activeExpressionReference(input.draft.expression).trim()?["reference"]:[])];
}
function referencePolicy(input:SourceRankingInput,frames:readonly {id:string}[]){
  const mode=input.draft.expression?.culturalMode,active=!!activeExpressionReference(input.draft.expression).trim();
  const ids=availableEvidence(input,frames),sources=active?["reference"]:ids.filter(id=>/^[vck]\d+$/.test(id));
  const enabled=mode!=="original"&&(mode!=="explicit"||active)&&sources.length>0;
  const kinds:("fictional"|"callback"|"plain")[]=enabled?["fictional","callback","plain"]:["plain"];
  return {kinds,sources,ids,choices:active?["explicit"]:["same-source","related"]};
}
function objectSchema(properties:Record<string,unknown>){
  return {type:"object",additionalProperties:false,required:Object.keys(properties),properties};
}
function referenceSchema(input:SourceRankingInput,frames:readonly {id:string}[]){
  const policy=referencePolicy(input,frames);
  const choice={type:"string",enum:policy.choices};
  const sourceId={$ref:"#/$defs/s"};
  const branches={
    fictional:objectSchema({kind:{type:"string",enum:["fictional"]},choice,sourceId,work:nameSchema(),
      characters:objectSchema({first:{$ref:"#/$defs/n"},second:{$ref:"#/$defs/n"}})}),
    callback:objectSchema({kind:{type:"string",enum:["callback"]},choice,sourceId,hook:textSchema("hook")}),
    plain:objectSchema({kind:{type:"string",enum:["plain"]}})
  };
  return {anyOf:policy.kinds.map(kind=>branches[kind])};
}
function appearanceSchema(frames:readonly {id:string}[]){
  const unknown={type:"object",additionalProperties:false,required:["style"],properties:{style:{type:"string",enum:["unknown"]}}};
  const observed={type:"object",additionalProperties:false,required:["style","frameId"],properties:{
    style:{type:"string",enum:replyVisualStyles.filter(style=>style.id!=="unknown").map(style=>style.id)},
    frameId:{type:"string",enum:frames.map(frame=>frame.id)}}};
  return {anyOf:frames.length?[unknown,observed]:[unknown]};
}
export function buildExpressVisualPlan(input:SourceRankingInput,source:MediaPreview,profile:ModelProfile,scope:ExecutionScope){
  requireVisual(source.samples.length<=Math.min(2,profile.imageCap),"image-budget-exceeded");
  const visual:MediaPreview={samples:source.samples.map((sample,i)=>({...sample,id:`v${i+1}`})),coverage:source.coverage};
  const {context,known}=evidenceInput(input);
  const policy=referencePolicy(input,visual.samples);
  requireVisual(context.length<=10,"local-context-limit");
  requireVisual(visual.samples.every(s=>context.some(c=>c.label===s.assetId)),"processing-review-required");
  requireVisual(!input.draft.visualContextId||visual.samples.length>0&&visual.samples.every(s=>s.assetId===input.draft.visualContextId),"processing-review-required");
  const expression=Object.fromEntries(Object.entries({...input.draft.expression,reference:activeExpressionReference(input.draft.expression)}).filter(([,value])=>value!==""&&value!=="auto"));
  const preferences=Object.fromEntries(Object.entries(input.draft.preferences).filter(([key,value])=>key!=="source"&&value!==""));
  const reportedProfile=input.speakerContext?.profile;
  const speakerProfile=reportedProfile?Object.fromEntries(Object.entries(reportedProfile).filter(([,v])=>v!==""&&v!=="unknown")):{};
  const payload={task:"plan-contextual-expression",intent:input.draft.intent,...(input.draft.creative?{creative:input.draft.creative}:{}),
    replyTo:input.draft.visualContextId?`c${context.findIndex(c=>c.label===input.draft.visualContextId)+1}`:null,
    ...(Object.keys(expression).length?{expression}:{}),preferences,
    ...(Object.keys(speakerProfile).length?{speaker:{role:input.speakerContext!.role,profile:speakerProfile}}:{}),
    context:context.map((c,i)=>{
      const role=input.contextRoles?.find(r=>r.label===c.label);
      return {id:`c${i+1}`,text:c.text,...(role?{role:role.role,...(c.text.startsWith(`${role.speaker}: `)?{}:{speaker:role.speaker})}:{})};
    }),
    ...(known.length?{knownSources:known.map((s,i)=>({id:`k${i+1}`,context:`c${context.findIndex(c=>c.label===s.label)+1}`,source:s.source,background:s.context}))}:{}),
    frames:visual.samples.map(s=>({id:s.id,context:`c${context.findIndex(c=>c.label===s.assetId)+1}`,timestampMs:s.timestampMs,
      ...(input.visualOrigins?.find(o=>o.label===s.assetId)?{origin:input.visualOrigins.find(o=>o.label===s.assetId)!.origin}:{})}))};
  const schema={type:"object",additionalProperties:false,
    $defs:{...(visual.samples.length||policy.kinds.includes("fictional")?{n:nameSchema(true)}:{}),
      ...(policy.kinds.includes("fictional")?{s:{type:"string",enum:policy.sources}}:{})},
    required:[...wireFields],
    properties:{reference:referenceSchema(input,visual.samples),searchMotif:{type:"string",enum:publicReplyMotifs},replyIntent:textSchema("replyIntent"),reason:textSchema("reason"),
      adaptedCaption:textSchema("adaptedCaption",true),familiarity:{type:"string",enum:input.draft.preferences.familiarity.trim()?["unknown","mixed","familiar","unfamiliar"]:["unknown"]},
      observedSources:objectSchema(Object.fromEntries(visual.samples.map(frame=>[frame.id,{$ref:"#/$defs/n"}]))),
      subject:{type:"string",enum:subjects},reaction:{type:"string",enum:reactions},medium:{type:"string",enum:media},
      appearance:appearanceSchema(visual.samples),
      motif:textSchema("motif"),subjectCount:{type:["integer","null"],enum:[null,1,2,3,4,5,6]}}};
  const format={type:"json_schema",json_schema:{name:"express_visual_plan_v12",strict:true,schema}};
  const outputReserve=Math.min(950,profile.outputTokens);
  const body=JSON.stringify({messages:[{role:"system",content:instruction},{role:"user",content:[
    {type:"text",text:JSON.stringify(payload)},...visual.samples.map(s=>({type:"image_url",image_url:{url:s.dataUrl,detail:"low"}}))]}],
    response_format:format,[profile.completionField]:outputReserve});
  const textBytes=Buffer.byteLength(instruction+JSON.stringify(payload)+JSON.stringify(format));
  // Preserve all reviewed text/preferences and the primary visual rather than truncate
  // current intent. The optional second sample is omitted before any provider call.
  if(visual.samples.length===2&&textBytes+2*profile.imageTokenUpperBound+512>Math.min(8500,profile.inputTokens,profile.contextTokens-outputReserve)){
    return buildExpressVisualPlan(input,{samples:source.samples.slice(0,1),coverage:source.coverage.map(c=>({...c,omitted:true,
      limitation:`${c.limitation} Secondary planning frame omitted to preserve reviewed text within the model budget.`}))},profile,scope);
  }
  const accounting=preflight(body,profile,visual,textBytes,outputReserve,scope);
  const review:ProcessingReview={version:0,digest:digest(body),profileVersion:profile.version,...accounting,outputReserve,media:visual};
  return {body,review};
}
export function validateExpressVisualPlan(value:unknown,input:SourceRankingInput,review:ProcessingReview):ExpressVisualPlan{
  schema(value&&typeof value==="object"&&!Array.isArray(value),"$","type",value);
  const wire=value as Record<string,unknown>,missing=wireFields.filter(field=>!Object.hasOwn(wire,field));
  if(missing.length)throw new PlanningSchemaError(missing.map(field=>({field,rule:"missing",actualType:"missing"})));
  schema(Object.keys(wire).length===wireFields.length,"$","unexpected-fields",wire);
  const reference=wire.reference;
  schema(reference&&typeof reference==="object"&&!Array.isArray(reference),"reference","type",reference);
  const ref=reference as Record<string,unknown>,policy=referencePolicy(input,review.media.samples);
  schema(typeof ref.kind==="string","reference.kind","type",ref.kind);
  schema(policy.kinds.some(kind=>kind===ref.kind),"reference.kind","enum",ref.kind);
  const keys=ref.kind==="fictional"?["characters","choice","kind","sourceId","work"]:ref.kind==="callback"?["choice","hook","kind","sourceId"]:["kind"];
  schema(keys.every(key=>Object.hasOwn(ref,key)),"reference","missing",ref);
  schema(Object.keys(ref).sort().join(",")===keys.join(","),"reference","unexpected-fields",ref);
  if(ref.kind!=="plain"){
    schema(typeof ref.choice==="string","reference.choice","type",ref.choice);
    schema(policy.choices.includes(ref.choice),"reference.choice","enum",ref.choice);
    schema(typeof ref.sourceId==="string","reference.sourceId","type",ref.sourceId);
    schema(policy.sources.includes(ref.sourceId),"reference.sourceId","enum",ref.sourceId);
  }
  const characters:string[]=[];
  if(ref.kind==="fictional"){
    schema(typeof ref.work==="string","reference.work","type",ref.work);
    schema(ref.characters&&typeof ref.characters==="object"&&!Array.isArray(ref.characters),"reference.characters","type",ref.characters);
    const cast=ref.characters as Record<string,unknown>;
    schema(Object.keys(cast).length===2&&Object.hasOwn(cast,"first")&&Object.hasOwn(cast,"second"),"reference.characters","unexpected-fields",cast);
    for(const slot of ["first","second"]){
      schema(cast[slot]===null||typeof cast[slot]==="string","reference.characters","items",cast[slot]);
      if(typeof cast[slot]==="string")characters.push(cast[slot]);
    }
  }
  schema(wire.observedSources&&typeof wire.observedSources==="object"&&!Array.isArray(wire.observedSources),"observedSources","type",wire.observedSources);
  const sources=wire.observedSources as Record<string,unknown>,frames=review.media.samples;
  schema(Object.keys(sources).length===frames.length&&frames.every(frame=>Object.hasOwn(sources,frame.id)),"observedSources","frame-count",sources);
  const observedSources=frames.map(frame=>{
    schema(sources[frame.id]===null||typeof sources[frame.id]==="string","observedSources","items",sources[frame.id]);
    return sources[frame.id];
  });
  schema(wire.appearance&&typeof wire.appearance==="object"&&!Array.isArray(wire.appearance),"appearance","type",wire.appearance);
  const appearance=wire.appearance as Record<string,unknown>,visualEvidence:string[]=[];
  schema(typeof appearance.style==="string","appearance.style","type",appearance.style);
  schema(replyVisualStyles.some(style=>style.id===appearance.style&&(style.id==="unknown"||review.media.samples.length>0)),
    "appearance.style","enum",appearance.style);
  if(appearance.style!=="unknown"){
    schema(typeof appearance.frameId==="string","appearance.frameId","type",appearance.frameId);
    schema(review.media.samples.some(frame=>frame.id===appearance.frameId),"appearance.frameId","enum",appearance.frameId);
    visualEvidence.push(appearance.frameId);
  }
  schema(Object.keys(appearance).length===(appearance.style==="unknown"?1:2),"appearance","unexpected-fields",appearance);
  const {reference:decision,appearance:observedAppearance,...common}=wire;
  const plain=ref.kind==="plain",explicit=ref.choice==="explicit";
  const resolved={...common,
    kind:plain?"none":ref.kind,referenceChoice:plain?"original":ref.choice,
    mode:plain?(["original","explicit"].includes(input.draft.expression?.culturalMode??"")?"override":"unanchored"):explicit?"override":"inherit",
    certainty:plain?"none":"grounded",franchise:ref.kind==="fictional"?ref.work:null,
    characters,observedSources,evidence:plain?[]:[ref.sourceId],
    hook:ref.kind==="callback"?ref.hook:null,visualStyle:appearance.style};
  try{return validateResolvedVisualPlan(resolved,input,review,visualEvidence);}
  catch(error){
    if(!(error instanceof PlanningSchemaError||error instanceof PlanningEvidenceError))throw error;
    const fields:Partial<Record<PlanningSchemaIssue["field"],PlanningSchemaIssue["field"]>>={
      franchise:"reference.work",characters:"reference.characters",hook:"reference.hook",kind:"reference.kind",
      mode:"reference.choice",referenceChoice:"reference.choice",certainty:"reference",evidence:"reference.sourceId"};
    const issues=error.issues.map(issue=>({...issue,field:fields[issue.field]??issue.field}));
    throw error instanceof PlanningSchemaError?new PlanningSchemaError(issues):new PlanningEvidenceError(issues);
  }
}
// Domain checks also cover the deterministic DTO consumed by generation and retrieval.
export function validateResolvedVisualPlan(value:unknown,input:SourceRankingInput,review:ProcessingReview,appearanceEvidence?:readonly string[]):ExpressVisualPlan{
  schema(value&&typeof value==="object"&&!Array.isArray(value),"$","type",value);
  const v=value as Record<string,unknown>;
  const missing=planningFields.filter(field=>!Object.hasOwn(v,field));
  if(missing.length)throw new PlanningSchemaError(missing.map(field=>({field,rule:"missing",actualType:"missing"})));
  schema(Object.keys(v).length===planningFields.length,"$","unexpected-fields",value);
  const short=(s:unknown,max:number,field:PlanningSchemaIssue["field"]):s is string=>{
    schema(typeof s==="string",field,"type",s);
    schema(s.trim().length>0,field,"empty",s);
    schema(s.length<=max,field,"length",s,max);
    schema(!/[<>\u0000-\u001f\u007f]/u.test(s),field,"format",s);return true;
  };
  const member=(s:unknown,allowed:readonly string[],field:PlanningSchemaIssue["field"]):s is string=>{
    schema(typeof s==="string",field,"type",s);schema(allowed.includes(s),field,"enum",s);return true;
  };
  requireVisual(short(v.replyIntent,expressPlanTextLimits.replyIntent,"replyIntent")&&short(v.reason,expressPlanTextLimits.reason,"reason")&&(v.adaptedCaption===null||short(v.adaptedCaption,expressPlanTextLimits.adaptedCaption,"adaptedCaption"))&&(v.hook===null||short(v.hook,expressPlanTextLimits.hook,"hook"))
    &&member(v.referenceChoice,["same-source","related","original","explicit"],"referenceChoice")
    &&member(v.familiarity,["unknown","mixed","familiar","unfamiliar"],"familiarity")&&member(v.searchMotif,publicReplyMotifs,"searchMotif"),"model-output-invalid-schema");
  grounded(input.draft.preferences.familiarity.trim()||v.familiarity==="unknown","familiarity","audience-report-required",v.familiarity);
  requireVisual(member(v.mode,["inherit","override","unanchored"],"mode")&&member(v.kind,["fictional","callback","motif","none"],"kind")
    &&member(v.certainty,["grounded","uncertain","none"],"certainty")&&member(v.subject,subjects,"subject")
    &&member(v.reaction,reactions,"reaction")&&member(v.medium,media,"medium"),"model-output-invalid-schema");
  const publicName=(s:unknown):s is string=>typeof s==="string"&&!!s.trim()&&s.trim()===s&&s.length<=expressPlanTextLimits.name
    &&!/[\u0000-\u001f\u007f]|https?:\/\/|\S+@\S+\.\S+|[_=<>]|\d{4,}/iu.test(s);
  schema(v.franchise===null||publicName(v.franchise),"franchise","format",v.franchise);
  grounded(Array.isArray(v.observedSources),"observedSources","type",v.observedSources);
  grounded(v.observedSources.length===review.media.samples.length,"observedSources","frame-count",v.observedSources);
  grounded(v.observedSources.every(s=>s===null||publicName(s)),"observedSources","source-name",v.observedSources);
  const observedSources=v.observedSources;
  const visualStyle=replyVisualStyles.find(style=>style.id===v.visualStyle);
  schema(visualStyle,"visualStyle",typeof v.visualStyle==="string"?"enum":"type",v.visualStyle);
  schema(Array.isArray(v.characters),"characters","type",v.characters);
  schema(v.characters.length<=2,"characters","length",v.characters);
  schema(v.characters.every(publicName),"characters","items",v.characters);
  requireVisual(short(v.motif,expressPlanTextLimits.motif,"motif"),"model-output-invalid-schema");
  schema(v.subjectCount===null||Number.isInteger(v.subjectCount)&&Number(v.subjectCount)>=1&&Number(v.subjectCount)<=6,"subjectCount","range",v.subjectCount);
  const activeReference=activeExpressionReference(input.draft.expression);
  const allowed=availableEvidence(input,review.media.samples);
  grounded(Array.isArray(v.evidence),"evidence","type",v.evidence);
  grounded(new Set(v.evidence).size===v.evidence.length,"evidence","unique-evidence",v.evidence);
  grounded(v.evidence.every(id=>typeof id==="string"&&allowed.includes(id)),"evidence","available-evidence",v.evidence);
  const evidence=v.evidence as string[];
  const frameEvidence=evidence.filter(id=>review.media.samples.some(s=>s.id===id));
  const textEvidence=evidence.some(id=>/^c\d+$/.test(id)||/^k\d+$/.test(id));
  const styleEvidence=appearanceEvidence??frameEvidence;
  grounded(styleEvidence.every(id=>review.media.samples.some(frame=>frame.id===id)),"appearance.frameId","available-evidence",styleEvidence);
  grounded(visualStyle.id==="unknown"||styleEvidence.length>0,"visualStyle","frame-evidence-required",v.visualStyle);
  const names=[...(v.franchise?[v.franchise]:[]),...v.characters];
  const explicit=!!activeReference.trim()&&(names.length>0&&names.some(name=>activeReference.toLowerCase().includes(name.toLowerCase()))
    ||v.kind==="callback"&&typeof v.hook==="string"&&(activeReference.toLowerCase().includes(v.hook.toLowerCase())
      ||evidence.includes("reference")));
  const culturalMode=input.draft.expression?.culturalMode??"follow-conversation";
  const usesReference=v.kind==="fictional"||v.kind==="callback";
  grounded(culturalMode!=="original"||!usesReference&&v.referenceChoice==="original","referenceChoice","original-mode",v.referenceChoice);
  grounded(culturalMode!=="explicit"||v.mode==="override"&&(usesReference?v.referenceChoice==="explicit":v.referenceChoice==="original"),"mode","explicit-mode",v.mode);
  grounded(v.kind==="callback"?v.hook!==null:v.hook===null,"hook","hook-kind",v.hook);
  if(v.kind==="fictional"){
    grounded(names.length>0,"kind","fictional-name-required",v.kind);
    grounded(v.certainty==="grounded","certainty","grounded-required",v.certainty);
    grounded(frameEvidence.length>0||textEvidence||explicit,"evidence","source-evidence-required",v.evidence);
    grounded(v.mode!=="override"||explicit,"mode","explicit-reference-required",v.mode);
    grounded(v.referenceChoice!=="original","referenceChoice","fictional-choice",v.referenceChoice);
    if(v.mode==="inherit"&&!explicit)grounded(textEvidence||frameEvidence.some(id=>observedSources[review.media.samples.findIndex(s=>s.id===id)]!==null),"observedSources","inheritance-evidence",v.observedSources);
  }else grounded(names.length===0,"kind","nonfictional-names",v.kind);
  if(v.kind==="callback"){
    grounded(v.certainty==="grounded","certainty","grounded-required",v.certainty);
    grounded(frameEvidence.length>0||textEvidence||explicit,"evidence","source-evidence-required",v.evidence);
    grounded(v.referenceChoice!=="original","referenceChoice","reference-choice",v.referenceChoice);
    grounded(v.mode!=="override"||explicit,"mode","explicit-reference-required",v.mode);
    grounded(v.mode!=="inherit"||frameEvidence.length>0||textEvidence,"evidence","inheritance-evidence",v.evidence);
  }
  grounded(v.referenceChoice!=="explicit"||explicit&&v.mode==="override","referenceChoice","explicit-reference-required",v.referenceChoice);
  grounded(v.referenceChoice!=="same-source"&&v.referenceChoice!=="related"||usesReference&&v.mode==="inherit","referenceChoice","reference-mode",v.referenceChoice);
  grounded(v.mode!=="unanchored"||!usesReference,"mode","unanchored-reference",v.mode);
  const publicMotif=v.searchMotif==="none"?"":v.searchMotif;
  const genericSubject=publicMotif?[...(["object","abstract"].includes(v.subject)?[]:[v.subject]),publicMotif].join(" "):v.subject;
  const primary=v.characters[0]??v.franchise??genericSubject;
  const requestedStyle=input.draft.expression?.style;
  const queryStyle=requestedStyle==="natural-photo"||requestedStyle==="cinematic-photo"?"photographic"
    :requestedStyle==="light-comic"||requestedStyle==="playful-doodle"||requestedStyle==="reaction-sticker"?"illustrated":visualStyle.id;
  const styleTerm=queryStyle==="illustrated"?"illustration":queryStyle==="photographic"?"photo":queryStyle==="rendered"?"rendered":"";
  const useMeme=v.referenceChoice!=="original"&&(v.kind==="fictional"||v.medium==="meme");
  const queryMedium=v.medium==="unknown"||v.referenceChoice==="original"&&["movie","video game","meme"].includes(v.medium)?"":v.medium;
  const suffix=[v.reaction,useMeme?"reaction meme":"reaction",queryMedium,styleTerm].filter(Boolean).join(" ");
  const query=[...[v.franchise&&v.characters[0]?`${v.franchise} ${v.characters[0]} ${suffix}`:null],`${primary} ${suffix}`,`${primary} ${v.reaction}`,`${v.subject} ${v.reaction} reaction`]
    .find((s):s is string=>typeof s==="string"&&validWebSearchTerms(s));
  schema(query,"query","query",query);
  return {searchMotif:v.searchMotif as ExpressVisualPlan["searchMotif"],hook:v.hook,referenceChoice:v.referenceChoice as ExpressVisualPlan["referenceChoice"],replyIntent:v.replyIntent,reason:v.reason,adaptedCaption:v.adaptedCaption,
    familiarity:v.familiarity as ExpressVisualPlan["familiarity"],observedSources:v.observedSources,mode:v.mode as ExpressVisualPlan["mode"],kind:v.kind as ExpressVisualPlan["kind"],franchise:v.franchise,
    characters:v.characters,subject:String(v.subject),reaction:String(v.reaction),medium:v.medium as ExpressVisualPlan["medium"],visualStyle:visualStyle.id,
    motif:v.motif,subjectCount:v.subjectCount as number|null,certainty:v.certainty as ExpressVisualPlan["certainty"],
    evidence:v.evidence as string[],...(appearanceEvidence?{visualEvidence:[...appearanceEvidence]}:{}),query,digest:review.digest};
}
