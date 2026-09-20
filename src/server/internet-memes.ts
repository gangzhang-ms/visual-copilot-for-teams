import {Worker} from "node:worker_threads";
import type {CatalogAsset} from "../catalog/visual-catalog";
import type {GenerationInspiration,LocalCatalogReview} from "../shared/local-chat";
import type {Transport} from "./graph-context";
import {digest} from "./analysis-session";
import {requireVisual,VisualError} from "./visual-errors";
import {generatedWorkerLease} from "./local-generation-config";
import {sniff} from "./media-normalizer";

export const memeEndpoint="https://api.imgflip.com/get_memes";
export interface Template {id:string;name:string;url:string;width:number;height:number;box_count:number}
type Files={preview:Buffer;analysis:Buffer;original?:Buffer;dimensions?:import("../shared/types").WebPreviewSize};
export interface MemeSnapshot {
  version:string;fetchedAt:number;assets:CatalogAsset[];review:LocalCatalogReview;bytes:number;
  read(id:string):Files|undefined;
  release():void;
  retain():()=>void;
}
const semantics:Record<string,string>={
  "181913649":"Contrasting rejection and preference; label the two alternatives. Avoid treating the pictured person as an endorsement.",
  "87743020":"Indecision between two choices; often a playful dilemma. Needs labels identifying the alternatives.",
  "112126428":"Attention shifting from one option to another; can imply disloyalty or objectification.",
  "222403160":"A repeated request for help; political origin may be unwelcome to some audiences.",
  "217743513":"Avoiding an option despite its cost; exaggeration may sound stubborn.",
  "124822590":"Abruptly choosing a different direction; an exaggerated change of plan.",
  "252600902":"A surprising realization; contains a threatening scene and may be unsuitable for gentle replies.",
  "322841258":"Optimistic question followed by uncertainty; fictional film characters, not a factual conversation.",
  "135256802":"Two sides finding common ground; shared agreement or teamwork.",
  "131940431":"A plan with an unexpected consequence; playful self-reflection.",
  "131087935":"Reaching for an objective while held back; needs labels and context.",
  "4087833":"Waiting a long time; dry exaggeration can feel impatient."
};
const photographicPatterns:Record<string,{name:string;pattern:string}>={
  "181913649":{name:"Drake Hotline Bling",pattern:"Choosing between alternatives: rejection and preference, two choices. Not an endorsement by the pictured person."},
  "112126428":{name:"Distracted Boyfriend",pattern:"Attention shifting to a tempting alternative; distraction, competing choices. May imply disloyalty."},
  "135256802":{name:"Epic Handshake",pattern:"Thanks, gratitude, support, teamwork, collaboration and shared agreement."},
  "61544":{name:"Success Kid",pattern:"Success, celebration, achievement, victory, relief after solving a problem."},
  "61579":{name:"One Does Not Simply",pattern:"A difficult task, complexity or caution about something that sounds too easy."}
};
function photoPattern(t:Template){
  const known=photographicPatterns[t.id];
  return known&&known.name.toLowerCase()===t.name.toLowerCase()?known.pattern:undefined;
}
export function templatePattern(t:Template){return photoPattern(t)??semantics[t.id];}
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v);}
export function parseTemplates(value:unknown,maximum=12):Template[]{
  requireVisual(record(value)&&value.success===true&&record(value.data)&&Array.isArray(value.data.memes)
    &&value.data.memes.length>=6&&value.data.memes.length<=100,"meme-source-invalid");
  const seen=new Set<string>();
  return value.data.memes.slice(0,maximum).map((v:unknown)=>{
    requireVisual(record(v)&&typeof v.id==="string"&&/^[0-9]{1,15}$/.test(v.id)&&!seen.has(v.id)
      &&typeof v.name==="string"&&v.name.length>0&&v.name.length<=100&&!/[<>\u0000-\u001f]/.test(v.name)
      &&typeof v.url==="string"&&/^https:\/\/i\.imgflip\.com\/[a-z0-9]+\.(jpg|png)$/.test(v.url)
      &&typeof v.width==="number"&&typeof v.height==="number"&&[v.width,v.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096)
      &&v.width*v.height<=4_000_000&&typeof v.box_count==="number"&&Number.isInteger(v.box_count)&&v.box_count>=1&&v.box_count<=20,"meme-source-invalid");
    seen.add(v.id);
    return {id:v.id,name:v.name,url:v.url,width:v.width,height:v.height,box_count:v.box_count};
  });
}
function rankTemplates(templates:Template[],intent:string,photo=false) {
  const words=(text:string)=>new Set([...new Intl.Segmenter("en",{granularity:"word"}).segment(text.toLowerCase())]
    .filter(part=>part.isWordLike&&part.segment.length>2&&!["the","and","for","with","from","this","that","image","original","one","not"].includes(part.segment)).map(part=>part.segment));
  const query=words(intent);
  const aliases:[string[],string[]][]=[
    [["选择","纠结","犹豫"],["choices","dilemma","indecision"]],
    [["等待","等了"],["waiting","long"]],
    [["合作","团队","同意"],["teamwork","agreement","common"]],
    [["意外","计划"],["plan","unexpected","consequence"]],
    [["帮忙","帮助"],["help","request"]]
  ];
  if(photo)aliases.push(
    [["谢谢","感谢","合作","thank","grateful","collaborat"],["thanks","gratitude","teamwork"]],
    [["成功","庆祝","解决","success","celebrat","solv"],["success","celebration","solving"]],
    [["困难","复杂","difficult","complicat"],["difficult","complexity"]],
    [["选择","纠结","choos","dilemma","options"],["choices","alternatives"]]
  );
  for(const [cues,tokens] of aliases)if(cues.some(cue=>intent.toLowerCase().includes(cue)))for(const token of tokens)query.add(token);
  const ranked=templates.map((template,rank)=>{
    const photographic=photoPattern(template);
    const pattern=(photo?photographic:undefined)??semantics[template.id]??"Captionable popular template; its meaning depends on context. Do not assume shared familiarity.";
    const terms=words(`${template.name} ${photo&&!photographic&&!semantics[template.id]?"":pattern}`);
    return {template,pattern,rank,photographic:!!photographic,score:[...query].filter(word=>terms.has(word)).length};
  }).sort((a,b)=>b.score-a.score||a.rank-b.rank);
  return ranked;
}
export function selectExistingTemplate(templates:Template[],intent:string){
  const matches=rankTemplates(templates,intent,true).filter(value=>value.score>0);
  return matches.find(value=>value.photographic)??matches[0];
}
export function selectMemeInspiration(templates:Template[],intent:string,fetchedAt:number):GenerationInspiration {
  const ranked=rankTemplates(templates,intent);
  const matches=ranked.filter(value=>value.score>0);
  return {mode:"popular-text",provider:"Imgflip",fetchedAt,selection:matches.length?"local-keyword-match":"popular-fallback",
    references:(matches.length?matches:ranked).slice(0,3).map(({template,pattern})=>({
      name:template.name,pattern,sourceUrl:`https://imgflip.com/meme/${template.id}`
    }))};
}
async function bytes(response:Response,limit:number,signal:AbortSignal){
  const reader=response.body?.getReader();requireVisual(reader,"meme-source-unavailable");
  let cancellation:Promise<void>|undefined;
  const cancel=()=>cancellation??=reader.cancel();
  const abort=()=>{void cancel().catch(()=>{/* The same cancellation is awaited by finally. */});};
  signal.addEventListener("abort",abort,{once:true});
  const chunks:Uint8Array[]=[];let size=0;
  try{
    requireVisual(Number(response.headers.get("content-length")??0)<=limit,"request-byte-budget-exceeded");
    for(;;){
      requireVisual(!signal.aborted,"cancelled");
      const result=await reader.read();requireVisual(!signal.aborted,"cancelled");
      if(result.done)break;
      size+=result.value.byteLength;requireVisual(size<=limit,"request-byte-budget-exceeded");chunks.push(result.value);
    }
    return Buffer.concat(chunks);
  }finally{signal.removeEventListener("abort",abort);try{await cancel();}finally{reader.releaseLock();}}
}
export async function normalizePublicImage(data:Buffer,t:{width?:number;height?:number;allowGif?:boolean;preservePreview?:boolean},signal:AbortSignal):Promise<Files>{
  const lease=generatedWorkerLease.acquire();
  try{return await new Promise<Files>((resolve,reject)=>{
    const worker=new Worker(new URL("./meme-media-worker.js",import.meta.url),{env:{},resourceLimits:{maxOldGenerationSizeMb:128},
      workerData:{bytes:data,width:t.width,height:t.height,allowGif:t.allowGif===true,preservePreview:t.preservePreview===true}});
    let finished=false;
    const finish=(error?:VisualError,value?:Files)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener("abort",abort);
      void worker.terminate().then(()=>signal.aborted?reject(new VisualError("cancelled")):error?reject(error):resolve(value!),
        ()=>{generatedWorkerLease.poison();reject(new VisualError("decoder-budget-exceeded"));});
    };
    const abort=()=>finish(new VisualError("cancelled"));
    const timer=setTimeout(()=>finish(new VisualError("decoder-budget-exceeded")),10_000);
    signal.addEventListener("abort",abort,{once:true});
    worker.once("message",v=>v.ok?finish(undefined,{    preview:Buffer.from(v.preview),analysis:Buffer.from(v.analysis),dimensions:v.dimensions}):finish(new VisualError("unsupported-format")));
    worker.once("error",()=>finish(new VisualError("unsupported-format")));
    worker.once("exit",()=>{if(!finished)finish(new VisualError("unsupported-format"));});
    if(signal.aborted)abort();
  });}finally{lease.release();}
}
export class InternetMemes {
  private loading=false;
  private cache=new Map<string,{snapshot:MemeSnapshot;refs:number}>();
  readonly counters={metadataRequests:0,imageRequests:0};
  constructor(private transport:Transport=fetch){}
  get retainedBytes(){return [...this.cache.values()].reduce((n,e)=>n+e.snapshot.bytes,0);}
  private async get(url:string,metadata:boolean,signal:AbortSignal){
    requireVisual(!signal.aborted,"cancelled");
    if(metadata)this.counters.metadataRequests++;else this.counters.imageRequests++;
    const response=await this.transport(url,{method:"GET",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer",signal,
      headers:{Accept:metadata?"application/json":"image/png,image/jpeg"}});
    if(!response.ok||response.redirected){await response.body?.cancel();throw new VisualError("meme-source-unavailable");}
    const mime=(response.headers.get("content-type")??"").split(";")[0].trim().toLowerCase();
    if(!(metadata?mime==="application/json":["image/png","image/jpeg"].includes(mime))){
      await response.body?.cancel();throw new VisualError("meme-source-invalid");
    }
    return {data:await bytes(response,metadata?256*1024:1024*1024,signal),mime};
  }
  async inspiration(intent:string,caller:AbortSignal):Promise<GenerationInspiration>{
    const signal=AbortSignal.any([caller,AbortSignal.timeout(15_000)]);
    try{
      const response=await this.get(memeEndpoint,true,signal);
      return selectMemeInspiration(parseTemplates(JSON.parse(response.data.toString("utf8")),100),intent,Date.now());
    }catch(error){
      if(signal.aborted)throw new VisualError(caller.aborted?"cancelled":"meme-source-unavailable");
      if(error instanceof VisualError&&error.code==="request-byte-budget-exceeded")throw new VisualError("meme-source-invalid");
      if(error instanceof VisualError)throw error;
      throw new VisualError("meme-source-unavailable");
    }
  }
  async load(caller:AbortSignal):Promise<MemeSnapshot>{
    requireVisual(!this.loading,"busy");this.loading=true;
    const signal=AbortSignal.any([caller,AbortSignal.timeout(90_000)]);
    const get=(url:string,metadata=false)=>this.get(url,metadata,signal);
    try{
      const response=await get(memeEndpoint,true),templates=parseTemplates(JSON.parse(response.data.toString("utf8")));
      return await this.snapshot(templates,signal);
    }catch(error){
      if(signal.aborted)throw new VisualError(caller.aborted?"cancelled":"timeout");
      if(error instanceof VisualError)throw error;
      throw new VisualError("meme-source-unavailable");
    }finally{this.loading=false;}
  }
  async search(intent:string,caller:AbortSignal,select?:(templates:readonly Template[],signal:AbortSignal)=>Promise<Template|undefined>):Promise<{inspiration:GenerationInspiration;snapshot?:MemeSnapshot;code?:string}> {
    requireVisual(!this.loading,"busy");this.loading=true;
    const signal=AbortSignal.any([caller,AbortSignal.timeout(30_000)]);
    try{
      const response=await this.get(memeEndpoint,true,signal),templates=parseTemplates(JSON.parse(response.data.toString("utf8")),100);
      const matched=select?await select(templates,signal):undefined;
      requireVisual(!matched||templates.includes(matched),"meme-source-invalid");
      const selected=select?(matched?{template:matched,pattern:templatePattern(matched)??"Meaning depends on the caption and audience; no pixel inspection."}:undefined):selectExistingTemplate(templates,intent);
      const inspiration:GenerationInspiration={mode:"popular-text",provider:"Imgflip",fetchedAt:Date.now(),selection:select?"model-semantic-match":"local-keyword-match",
        references:selected?[{name:selected.template.name,pattern:selected.pattern,sourceUrl:`https://imgflip.com/meme/${selected.template.id}`}]:[]};
      if(!selected)return {inspiration,code:"generation-source-no-match"};
      try{return {inspiration,snapshot:await this.snapshot([selected.template],signal,true)};}
      catch(error){
        if(signal.aborted)throw error;
        return {inspiration,code:error instanceof VisualError?error.code:"meme-source-unavailable"};
      }
    }catch(error){
      if(signal.aborted)throw new VisualError(caller.aborted?"cancelled":"timeout");
      if(error instanceof VisualError)throw error;
      throw new VisualError("meme-source-unavailable");
    }finally{this.loading=false;}
  }
  private async snapshot(templates:Template[],signal:AbortSignal,keepOriginal=false):Promise<MemeSnapshot>{
      const get=(url:string)=>this.get(url,false,signal);
      const key=digest(JSON.stringify(templates)+(keepOriginal?":original":"")),existing=this.cache.get(key);
      if(existing){existing.refs++;return existing.snapshot;}
      const files=new Map<string,Files>();let retained=0;
      for(const t of templates){
        const response=await get(t.url);
        requireVisual(sniff(response.data)===response.mime,"unsupported-format");
        const file=await normalizePublicImage(response.data,t,signal);
        const owned:Files={...file,...(keepOriginal?{original:response.data}:{})};
        retained+=file.preview.length+file.analysis.length+(owned.original?.length??0);
        requireVisual(retained<=8*1024*1024&&this.retainedBytes+retained<=32*1024*1024,"request-byte-budget-exceeded");
        files.set(`imgflip-${t.id}`,owned);
      }
      requireVisual(!signal.aborted,"cancelled");
      const fetchedAt=Date.now(),version=digest(key+JSON.stringify([...files].map(([id,f])=>[id,digest(f.preview)])));
      const assets:CatalogAsset[]=templates.map(t=>{
        const id=`imgflip-${t.id}`,file=files.get(id)!;
        const description=semantics[t.id]??"Popular captionable image template. Meaning depends on labels, context and audience; do not assume shared familiarity.";
        const visual:CatalogAsset["public"]={id,version,category:"meme",alt:t.name,imageUrl:`/local/memes/${version}/${id}.png`,
          template:{kind:"popular-template",provider:"Imgflip",name:t.name,fetchedAt,sourceUrl:t.url,description},
          notices:{version:"imgflip-api-local-v1",source:`Imgflip popular template: ${t.name}`,creator:"Underlying creator/rights holder not verified.",
            license:"API documentation allows embedding returned image URLs; underlying copyright and external redistribution are not certified.",
            text:[`Cached ${new Date(fetchedAt).toISOString()}. Static uncaptioned template; usually needs a caption. Not a GIF.`,
              ...(file.original?[`Original download SHA-256: ${digest(file.original)}. Normalized locally, not AI redrawn. Caption is adjacent text, not burned into these pixels.`]:[]),
              "Provider popular templates, not an all-internet or Chinese real-time trend feed. Local testing does not certify hackathon/public redistribution rights."],
            links:[{label:"Template source",url:`https://imgflip.com/meme/${t.id}`},{label:"Imgflip API terms",url:"https://imgflip.com/api"}]}};
        return {public:visual,tags:[description,`${t.box_count} caption boxes; optional local text is not burned into the image.`],safe:false,
          rights:{version:"imgflip-api-local-v1",approved:false,evidence:"https://imgflip.com/api",validFrom:0,validUntil:0,withdrawn:false,
            publicHosting:false,redistribution:false,transformations:false,poster:false,downstreamRecallRequired:false},
          rendition:{version,digest:digest(file.preview),rightsVersion:"imgflip-api-local-v1",noticeVersion:visual.notices.version,verifiedAvailable:true,transformation:"derived"}};
      });
      const review:LocalCatalogReview={digest:version,assets:assets.map(a=>({visual:a.public,provenance:"Public Imgflip API template, locally decoded; no rights certification.",
        hashes:[{file:a.public.id,sha256:a.rendition.digest},...(files.get(a.public.id)?.original?[{file:`${a.public.id}-original`,sha256:digest(files.get(a.public.id)!.original!)}]:[])]}))};
      const snapshot:MemeSnapshot={version,fetchedAt,assets,review,bytes:retained,read:id=>files.get(id),
        release:()=>{const entry=this.cache.get(key);if(entry&&--entry.refs===0)this.cache.delete(key);},
        retain:()=>{const entry=this.cache.get(key);requireVisual(entry,"asset-rights-unavailable");entry.refs++;
          let released=false;return ()=>{if(!released){released=true;snapshot.release();}};}};
      this.cache.set(key,{snapshot,refs:1});return snapshot;
  }
}
