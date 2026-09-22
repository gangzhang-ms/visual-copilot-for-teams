import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { LocalInsertPreview, LocalMessage, LocalReview, LocalState } from "../shared/local-chat";
import {hasLocalVisual,canExplainLocalMessage,selectedEmoji} from "../shared/local-chat";
import type { MediaPreview, ReviewInput } from "../shared/types";
import { AnalysisSessions, opaque, type AnalysisSession } from "./analysis-session";
import { AnalysisService } from "./analysis-service";
import { GraphContext, type Transport } from "./graph-context";
import { MediaResolver } from "./media-resolver";
import { normalizeMedia, sniff } from "./media-normalizer";
import { ModelGateway,type ModelDiagnostic } from "./model-gateway";
import {buildSourceRanking,validateSourceRanking} from "./meme-source-ranking";
import {BraveImageSearch} from "./brave-image-search";
import {CommonsImageSearch,type CommonsDiagnostic} from "./commons-image-search";
import {SerpApiImageSearch} from "./serpapi-image-search";
import {setTimeout as sourceDelay} from "node:timers/promises";
import {buildSearchQueryPlan,validateSearchQueryPlan} from "./image-search-query";
import {buildExpressVisualPlan,validateExpressVisualPlan} from "./express-visual-plan";
import {searchWebImages,WebImageSearchError} from "./web-image-search";
import {deriveWebSearchTerms} from "../shared/web-search-terms";
import { loadLocalChatConfig } from "./local-chat-config";
import { loadLocalCatalog } from "./local-catalog";
import { failure, requireVisual, VisualError, PlanningSchemaError, PlanningEvidenceError } from "./visual-errors";
import { LocalGenerationSession, generationObject, generationText, type LocalGenerationOptions } from "./local-generation";
import { GenerationError, generationLimits, localPaidLease, generatedWorkerLease, generationReadiness, loadGenerationProfile } from "./local-generation-config";
import {validSpeakerProfile,type SpeakerContext,type SpeakerProfile} from "../shared/expression";
import {InternetMemes,type MemeSnapshot} from "./internet-memes";
import type {CatalogAsset} from "../catalog/visual-catalog";
import {localDemo,combinedDemoTimes} from "./local-demo";
import {roomMediaPolicy,withinRoomMediaBudget} from "./local-generation-config";
import {modelRequestLimit} from "./visual-config";
import type {ImageCapabilityState} from "./image-generation-gateway";
import {LOCAL_CONTEXT_REVIEW_LIMIT,localContextWithinLimit} from "../shared/local-context";
import {parseEmojiDraft,buildEmojiExpression,validateEmojiOptions} from "./emoji-expression";
import {emojiInsertion,type EmojiSuggestions} from "../shared/emoji-expression";
import {validDemoChatId,demoRoomLifetimeMs,scopedDemoMedia} from "../shared/demo-room";

interface GeneratedCache {
  assetId:string;version:number;detached:boolean;inFlight:number;compressedBytes:number;snapshotBytes:number;
  owners:Set<"analysis-media"|"local-review"|"processing">;release:()=>void;
}

interface BrowserSession {
  chatId?:string;
  knownSources:Map<string,{source:string;context:string}>;
  emojiSuggestions?:EmojiSuggestions;
  creationSnapshot?:MemeSnapshot;
  catalogSource:"internet"|"original-demo";catalogAssets:CatalogAsset[];memeCatalog?:MemeSnapshot;memeSnapshots:Map<string,MemeSnapshot>;
  outgoingSpeaker:string;profiles:Map<string,SpeakerProfile>;
  csrf: string; expiresAt: number; revision: number; messages: LocalMessage[];
  media: Map<string, MediaPreview>; attachmentBytes: Map<string, number>; attestation?: string;
  analysis: AnalysisSession; service: AnalysisService; review?: LocalReview; preview?: LocalInsertPreview; explainMessageId?:string;
  busy: boolean;
  generation: LocalGenerationSession;
  generatedCache?: GeneratedCache;
}
const text = (v: unknown, max: number) => {
  requireVisual(typeof v === "string" && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), "processing-review-required");
  return v;
};
function object(value: unknown): Record<string, unknown> {
  requireVisual(value && typeof value === "object" && !Array.isArray(value), "processing-review-required");
  return value as Record<string, unknown>;
}
async function readBody(req: IncomingMessage) {
  requireVisual(req.headers["content-type"] === "application/json", "permission-denied");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; requireVisual(size <= 2 * 1024 * 1024, "request-byte-budget-exceeded"); chunks.push(Buffer.from(chunk));
  }
  return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

export async function createLocalChatServer(key: string, options: { sharedDemo?:boolean;emojiExpressions?:boolean;contextualCreation?:boolean;transport?: Transport; cooldownMs?: number; clientRoot?: string; generation?: LocalGenerationOptions;interaction?:"direct-personal";creationChoices?:boolean;mixedCreation?:boolean;semanticCreation?:boolean;webCreation?:boolean;webProvider?:"commons"|"brave"|"serpapi";webSearchKey?:string;webCredentialUnavailable?:boolean;webSearchTransport?:Transport;sourceDiagnostic?:(event:CommonsDiagnostic)=>void;catalogSource?:"original-demo";memeTransport?:Transport;modelDiagnostic?:(event:ModelDiagnostic)=>void } = {}) {
  const sharedDemo=options.sharedDemo===true;
  const direct=options.interaction==="direct-personal";
  const emojiExpressions=direct&&options.emojiExpressions===true;
  const creationChoices=direct&&options.creationChoices===true;
  const mixedCreation=creationChoices&&options.mixedCreation===true;
  const webCreation=mixedCreation&&options.webCreation===true;
  const contextualCreation=webCreation&&options.contextualCreation===true;
  const semanticCreation=mixedCreation&&(options.semanticCreation===true||webCreation);
  const mediaPolicy=roomMediaPolicy(direct);
  const config = loadLocalChatConfig(key,direct), catalog = await loadLocalCatalog(direct), analysisSessions = new AnalysisSessions();
  const permission=(s:BrowserSession)=>direct?catalog.digest:s.attestation;
  const memes=new InternetMemes(options.memeTransport);
  const search=options.webProvider==="serpapi"?new SerpApiImageSearch(options.webSearchKey,options.webSearchTransport,options.webCredentialUnavailable):
    options.webProvider==="brave"?new BraveImageSearch(options.webSearchKey,options.webSearchTransport,options.webCredentialUnavailable):new CommonsImageSearch(options.webSearchTransport,options.sourceDiagnostic);
  const searchState:NonNullable<LocalState["webCreation"]>={configured:search.configured,provider:search.id,keyRequired:search.id!=="Wikimedia Commons"};
  const permitted=(s:BrowserSession,asset:CatalogAsset)=>s.catalogSource==="internet"
    ?!!s.memeCatalog&&s.memeCatalog.assets.some(a=>a.public.id===asset.public.id&&JSON.stringify(a)===JSON.stringify(asset))
    :catalog.permits(asset,permission(s));
  function selectCatalog(s:BrowserSession){s.catalogAssets.splice(0,s.catalogAssets.length,...(s.catalogSource==="internet"?s.memeCatalog?.assets??[]:catalog.assets));}
  function pruneMemes(s:BrowserSession){
    for(const [version,snapshot] of s.memeSnapshots)if(snapshot!==s.memeCatalog&&snapshot!==s.creationSnapshot&&!s.messages.some(m=>m.visual?.version===version)){
      snapshot.release();s.memeSnapshots.delete(version);
    }
  }
  const analysisInterval=options.cooldownMs??(direct?6100:61_000);
  const permits = new Set<string>(); config.localRequestDigests = permits;
  const sessions = new Map<string, BrowserSession>(), counters = { providerRequests: 0, graphRequests: 0 };
  const retiring=new Set<BrowserSession>();
  const generationCounters = { providerRequests: 0 };
  const generationCapability:ImageCapabilityState={};
  const cacheGroups=new Set<GeneratedCache>(),requests=new Set<Promise<void>>();
  let origin = "", cooldownUntil = 0;
  const cookieName=()=>new URL(origin).port==="4317"?"local_chat":`local_chat_${new URL(origin).port}`;
  const transport: Transport = async (url, init) => {
    cooldownUntil = Date.now() + analysisInterval; localPaidLease.pace(analysisInterval); counters.providerRequests++;
    const response=await (options.transport ?? fetch)(url, init);
    if(direct&&response.status===429){
      const retry=response.headers.get("retry-after"),seconds=retry?Number(retry):NaN;
      const wait=Math.min(300_000,Math.max(6100,Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry??"")-Date.now())||61_000));
      cooldownUntil=Date.now()+wait;localPaidLease.defer(wait);
    }
    return response;
  };
  const denied: Transport = async () => { counters.graphRequests++; throw new VisualError("permission-denied"); };
  const graph = new GraphContext(config, denied), resolver = new MediaResolver(config, graph, denied), gateway = new ModelGateway(config, transport,options.modelDiagnostic);
  const sourceGateway=new ModelGateway(config,transport,options.modelDiagnostic);
  const queryGateway=new ModelGateway(config,transport,options.modelDiagnostic);
  const clientRoot = options.clientRoot ?? resolve("dist", "client"), staticFiles = new Map<string, { bytes: Buffer; mime: string }>();
  for (const file of await readdir(resolve(clientRoot, "assets"))) {
    if (/\.(js|css)$/.test(file)) staticFiles.set(`/assets/${file}`, { bytes: await readFile(resolve(clientRoot, "assets", file)),
      mime: file.endsWith(".js") ? "text/javascript" : "text/css" });
  }
  const chatHtml=await readFile(resolve(clientRoot,"local-chat.html"),"utf8");
  staticFiles.set("/chat", { bytes: Buffer.from(sharedDemo?chatHtml.replace("</head>",'<meta name="local-shared-demo" content="true"></head>'):chatHtml), mime: "text/html" });
  staticFiles.set("/manual", { bytes: await readFile(resolve(clientRoot, "index.html")), mime: "text/html" });
  const state = (s: BrowserSession): LocalState => ({ revision: s.revision, messages: s.messages,mediaBytes:ordinaryBytes(s)+s.generation.bytes(), catalogAccepted: s.catalogSource==="internet"?!!s.memeCatalog:permission(s) === catalog.digest,
    ...(s.chatId?{sharedRoom:{chatId:s.chatId,expiresAt:s.expiresAt}}:{}),
    ...(creationChoices?{creationChoices:true}:{}),
    ...(contextualCreation?{contextualCreation:true}:{}),
    ...(emojiExpressions?{emojiExpressions:true}:{}),
    ...(mixedCreation?{mixedCreation:true}:{}),
    ...(semanticCreation?{semanticCreation:true}:{}),
    ...(webCreation?{webCreation:searchState}:{}),
    ...(direct?{catalogSource:s.catalogSource,...(s.memeCatalog?{internetCatalog:s.memeCatalog.review}:{})}:{}),
    outgoingSpeaker:s.outgoingSpeaker,speakerProfiles:[...s.profiles].map(([speaker,profile])=>({speaker,profile})),
    cooldownUntil: Math.max(cooldownUntil,localPaidLease.nextAt), providerRequests: counters.providerRequests,
    generation:creationChoices&&s.busy?{...s.generation.readiness(),ready:false,reason:"generation-busy"}:s.generation.readiness(),...(direct?{interaction:"direct-personal" as const}:{}) });
  const ordinaryBytes=(s:BrowserSession)=>[...s.memeSnapshots.values()].reduce((n,c)=>n+c.bytes,0)+[...s.attachmentBytes.values()].reduce((a,b)=>a+b,0)+[...s.media.values()].reduce((n,m)=>n+m.samples.reduce((a,f)=>a+f.bytes,0),0);
  async function prepareMessage(s:BrowserSession,body:Record<string,unknown>,stagedBytes=0){
    const speaker=text(body.speaker,40).trim(),content=text(body.text,2000),id=opaque(),version=s.revision,signal=s.analysis.abort.signal;
    requireVisual(speaker&&(content.trim()||body.attachment),"processing-review-required");
    const message:LocalMessage={id,speaker,text:content,createdAt:Date.now()};
    let media:MediaPreview|undefined,bytesCount=0;
    if(body.attachment){
      const attachment=object(body.attachment),base64=text(attachment.base64,1_400_000),mime=text(attachment.mime,40);
      requireVisual(/^[A-Za-z0-9+/]+={0,2}$/.test(base64),"unsupported-format");
      const bytes=Buffer.from(base64,"base64");bytesCount=bytes.length;
      requireVisual(bytes.length<=1024*1024&&bytes.toString("base64")===base64&&sniff(bytes)===mime,"unsupported-format");
      requireVisual(withinRoomMediaBudget(ordinaryBytes(s)+stagedBytes+bytes.length+s.generation.bytes(),mediaPolicy),"request-byte-budget-exceeded");
      const category=mime==="image/gif"?"gif":attachment.category==="sticker"?"sticker":"image";
      media=await normalizeMedia([{id,bytes,mime,category}],config.profile!,config.mediaLimits!,signal,config.executionScope);
      requireVisual(withinRoomMediaBudget(ordinaryBytes(s)+stagedBytes+bytes.length+media.samples.reduce((n,f)=>n+f.bytes,0)+s.generation.bytes(),mediaPolicy),"request-byte-budget-exceeded");
      message.attachment={dataUrl:`data:${mime};base64,${base64}`,category};
    }
    requireVisual(s.revision===version&&!signal.aborted&&s.expiresAt>Date.now(),"cancelled");
    return {message,media,bytesCount};
  }
  function commitMessage(s:BrowserSession,value:Awaited<ReturnType<typeof prepareMessage>>){
    s.messages.push(value.message);
    if(value.media){s.media.set(value.message.id,value.media);s.attachmentBytes.set(value.message.id,value.bytesCount);}
  }
  function invalidate(s: BrowserSession, keepGeneration = false) {
    delete s.emojiSuggestions;
    if (s.review) permits.delete(s.review.processing.digest);
    analysisSessions.invalidate(s.analysis);s.revision++;delete s.review;delete s.preview;delete s.explainMessageId;
    if (s.generatedCache) {
      const cache=s.generatedCache; cache.detached=true;cache.owners.clear();delete s.generatedCache;delete s.analysis.media;
      if (!cache.inFlight) cache.release();
    }
    if (!keepGeneration) s.generation.invalidate();
  }
  function erase(s: BrowserSession) {
    s.knownSources.clear();
    delete s.memeCatalog;for(const snapshot of s.memeSnapshots.values())snapshot.release();s.memeSnapshots.clear();selectCatalog(s);
    s.profiles.clear();s.outgoingSpeaker="Alex";
    invalidate(s); s.generation.invalidate(true); s.messages = []; s.media.clear(); s.attachmentBytes.clear(); delete s.attestation;
    delete s.analysis.media; s.analysis.sources.clear(); s.analysis.mediaSources.clear();
  }
  function collectRetired(){
    for(const s of retiring)if(!s.busy&&s.generation.bytes()===0)retiring.delete(s);
  }
  function retire(id:string,s:BrowserSession){
    erase(s);sessions.delete(id);retiring.add(s);collectRetired();
  }
  const timer = setInterval(() => {
    for (const [id, s] of sessions) { s.generation.cleanup(); if (s.expiresAt <= Date.now())retire(id,s); }
    collectRetired();
  }, 30_000); timer.unref();
  function newSession(chatId?:string): BrowserSession {
    for(const [id,s] of sessions)if(s.expiresAt<=Date.now())retire(id,s);
    collectRetired();
    if(!direct)requireVisual(sessions.size+retiring.size < 4, "local-session-capacity");
    const analysis: AnalysisSession = { id: opaque(), binding: { invocationId: "local-simulation", tenantId: "", userId: "",
      commandId: "explainVisual", commandContext: "compose" }, accessToken: "", expiresAt: Date.now() + demoRoomLifetimeMs,
      version: 1, shareVersion: 1, abort: new AbortController(), sources: new Map(), mediaSources: new Map() };
    const s: BrowserSession = {chatId,knownSources:new Map(),catalogSource:direct&&!options.catalogSource?"internet":"original-demo",catalogAssets:[],memeSnapshots:new Map(),outgoingSpeaker:"Alex",profiles:new Map(),csrf: opaque(), expiresAt: analysis.expiresAt, revision: 1, messages: [], media: new Map(),
      attachmentBytes: new Map(), analysis, busy: false, service: undefined!, generation: undefined! };
    const plannedQueries=new WeakMap<import("./meme-source-ranking").SourceRankingInput,{query:string;digest:string}>();
    s.generation = new LocalGenerationSession({ id:analysis.id, expiresAt:s.expiresAt, revision:()=>s.revision, messages:()=>s.messages,
      ordinaryBytes:()=>ordinaryBytes(s),mediaPolicy,...(direct?{speakerContext:():SpeakerContext=>({role:"outgoing-speaker",source:"voluntary-local-report",profile:s.profiles.get(s.outgoingSpeaker)??null})}:{}) },key,{...options.generation,capability:generationCapability,creationChoices,mixedCreation,webCreation,
        inspiration:(intent,signal)=>memes.inspiration(intent,signal),
        ...(contextualCreation?{plan:async(input:import("./meme-source-ranking").SourceRankingInput,signal:AbortSignal)=>{
          const version=s.revision,included=new Set(input.draft.context.filter(c=>c.included).map(c=>c.label));
          input.contextRoles=s.messages.filter(m=>included.has(m.id)).map(m=>({label:m.id,speaker:m.speaker,role:m.speaker===s.outgoingSpeaker?"outgoing":"other"}));
          input.knownSources=s.messages.filter(m=>included.has(m.id)&&s.knownSources.has(m.id)).slice(-2).map(m=>({label:m.id,...s.knownSources.get(m.id)!}));
          input.visualOrigins=s.messages.filter(m=>included.has(m.id)).map(m=>({label:m.id,origin:m.generated?"generated-interpretation":m.demoMedia==="custom-emoji"?"original-custom-emoji":"conversation-image"}));
          const visuals=s.messages.filter(m=>included.has(m.id)&&hasLocalVisual(m));
          const incoming=visuals.filter(m=>m.speaker!==s.outgoingSpeaker);
          const candidates=incoming.length?incoming:visuals;
          const explained=candidates.filter(m=>s.knownSources.has(m.id)).at(-1);
          const selected=input.draft.visualContextId?visuals.filter(m=>m.id===input.draft.visualContextId):
            explained?[explained,...candidates.filter(m=>m.id!==explained.id).slice(-1)]:
              candidates.length>1?[candidates[0],candidates.at(-1)!]:candidates;
          requireVisual(!input.draft.visualContextId||selected.length===1,"processing-review-required");
          const media:MediaPreview={samples:[],coverage:[]};
          for(const message of selected){
            let normalized=s.media.get(message.id);
            let release:(()=>void)|undefined;
            try{
              if(!normalized&&message.visual){
                const external=!!(message.visual.webSource||message.visual.template);
                const owned=external?s.memeSnapshots.get(message.visual.version)?.read(message.visual.id):undefined;
                const source=owned?{bytes:owned.analysis,mime:"image/png"}:!external&&permission(s)===catalog.digest
                  ?catalog.read(message.visual.id,message.visual.animationUrl?"animation":"still"):undefined;
                requireVisual(source,"media-unavailable");
                normalized=await normalizeMedia([{id:message.id,bytes:source.bytes,mime:source.mime,category:message.visual.category}],
                  config.profile!,config.mediaLimits!,signal,config.executionScope);
              }else if(!normalized&&message.generated){
                const source=await s.generation.explainSource(message.generated,signal);release=source.release;
                normalized=await normalizeMedia([{id:message.id,bytes:source.bytes,mime:source.mime,category:source.category}],
                  config.profile!,config.mediaLimits!,signal,config.executionScope);
              }
              requireVisual(normalized?.samples.length,"media-unavailable");
              const samples=selected.length>1?[normalized.samples[0]]:normalized.samples.length>1?[normalized.samples[0],normalized.samples.at(-1)!]:normalized.samples;
              media.samples.push(...structuredClone(samples));
              media.coverage.push(...normalized.coverage.map(c=>({...c,              omitted:c.omitted||normalized!.samples.length>samples.length,
                limitation:`${c.limitation} Express uses at most two representative frames from this owned visual.`})));
            }finally{release?.();}
          }
          requireVisual(config.profile&&!queryGateway.isSuspended(),"model-capability-unverified");
          requireVisual(!signal.aborted&&s.revision===version&&s.expiresAt>Date.now(),"cancelled");
          const request=buildExpressVisualPlan(input,media,config.profile,config.executionScope??"production");
          const lease=localPaidLease.acquire(analysisInterval);permits.add(request.review.digest);
          try{
            const output=await queryGateway.run(request.body,request.review,signal);
            requireVisual(!signal.aborted&&s.revision===version&&s.expiresAt>Date.now(),"cancelled");
            const plan=validateExpressVisualPlan(output,input,request.review);
            plannedQueries.set(input,{query:plan.query,digest:request.review.digest});
            return plan;
          }catch(error){
            if(error instanceof VisualError&&["model-provider-auth","model-capability-unverified","model-contract-rejected","model-refused","cancelled"].includes(error.code))throw error;
            const code=error instanceof VisualError?error.code:"unknown";
            throw new GenerationError("generation-context-planning",code==="model-output-invalid-schema"?"schema":
              code==="model-output-invalid-references"?"evidence":code==="model-output-truncated"?"truncated":
              code==="model-output-invalid-json"?"invalid-json":code==="model-provider-unavailable"||code==="model-network-error"?"provider":"unavailable",
              error instanceof PlanningSchemaError||error instanceof PlanningEvidenceError?error.issues:undefined);
          }finally{permits.delete(request.review.digest);lease.release();}
        }}:{}),
        source:async(intent,signal,input)=>{
          const version=s.revision;
          const select=async(templates:readonly import("./internet-memes").Template[],sourceSignal:AbortSignal)=>{
            requireVisual(config.profile&&!sourceGateway.isSuspended(),"model-capability-unverified");
            requireVisual(!sourceSignal.aborted&&s.revision===version&&s.expiresAt>Date.now(),"cancelled");
            const request=buildSourceRanking(input,templates,config.profile,config.executionScope??"production",webCreation);
            const lease=localPaidLease.acquire(analysisInterval);
            permits.add(request.review.digest);
            try{
              const output=await sourceGateway.run(request.body,request.review,sourceSignal);
              requireVisual(!sourceSignal.aborted&&s.revision===version&&s.expiresAt>Date.now(),"cancelled");
              return validateSourceRanking(output,templates,input.contextPlan);
            }finally{permits.delete(request.review.digest);lease.release();}
          };
          let found:{snapshot?:MemeSnapshot;inspiration?:import("../shared/local-chat").GenerationInspiration;code?:string};
          let publicQuery:string|undefined;
          if(webCreation){
            if(!search.configured)return {code:search.missingCode()};
            let query=input.draft.searchTerms?.trim()||input.contextPlan?.query;
            if(search.id==="Google Images via SerpApi"&&!query){
              query=plannedQueries.get(input)?.query;
              if(!query){
                requireVisual(config.profile,"model-capability-unverified");
                if(queryGateway.isSuspended())return {code:"web-image-search-query-planning"};
                const request=buildSearchQueryPlan(input,config.profile,config.executionScope??"production");
                const lease=localPaidLease.acquire(analysisInterval);permits.add(request.review.digest);
                try{
                  const output=await queryGateway.run(request.body,request.review,signal);
                  requireVisual(!signal.aborted&&s.revision===version&&s.expiresAt>Date.now(),"cancelled");
                  query=validateSearchQueryPlan(output,input);
                  plannedQueries.set(input,{query,digest:request.review.digest});
                }catch(error){
                  if(error instanceof VisualError&&["model-provider-auth","model-capability-unverified","model-contract-rejected","model-refused","cancelled"].includes(error.code))throw error;
                  throw new WebImageSearchError("web-image-search-query-planning");
                }finally{permits.delete(request.review.digest);lease.release();}
              }
            }
            query??=deriveWebSearchTerms(input.draft.intent);publicQuery=query;
            let result:Awaited<ReturnType<typeof searchWebImages>>;
            try{result=await searchWebImages(search,{terms:query},signal);}
            catch(error){if(error instanceof WebImageSearchError&&!signal.aborted)return {code:error.code,searchTerms:query};throw error;}
            if(result.status==="unavailable")return {code:result.code};
            if(result.status==="empty")return {code:"generation-source-no-match",searchTerms:query};
            const templates=result.items.map(item=>({id:item.id,name:item.title,url:item.thumbnailUrl!,width:1,height:1,box_count:1}));
            if(search.id==="Google Images via SerpApi"&&plannedQueries.has(input)&&localPaidLease.providerNextAt<=Date.now()){
              const wait=Math.max(0,localPaidLease.nextAt-Date.now());
              if(wait)await sourceDelay(wait,undefined,{signal});
            }
            const selected=await select(templates,signal);
            if(!selected)return {code:"generation-source-no-match",searchTerms:query};
            const item=result.items.find(item=>item.id===selected.id)!;
            found={snapshot:await search.snapshot(item,query,signal),inspiration:{mode:"web-text",provider:search.id,fetchedAt:Date.now(),
              selection:"model-semantic-match",references:[{name:item.title,pattern:"Web search title only; no verified visual interpretation or source pixels supplied.",sourceUrl:item.sourcePageUrl}]}};
          }else found=await memes.search(intent,signal,semanticCreation?select:undefined);
          const snapshot=found.snapshot;
          if(!snapshot)return {inspiration:found.inspiration,code:found.code};
          try{
            requireVisual(!signal.aborted&&s.revision===version&&s.expiresAt>Date.now(),"cancelled");
            requireVisual(withinRoomMediaBudget(ordinaryBytes(s)+(s.memeSnapshots.has(snapshot.version)?0:snapshot.bytes)+s.generation.bytes(),mediaPolicy),"request-byte-budget-exceeded");
          }catch(error){snapshot.release();throw error;}
          if(s.memeSnapshots.has(snapshot.version))snapshot.release();else s.memeSnapshots.set(snapshot.version,snapshot);
          s.creationSnapshot=snapshot;let released=false;
          return {inspiration:found.inspiration,...(publicQuery?{searchTerms:publicQuery}:{}),source:{visual:snapshot.assets[0].public,release:()=>{
            if(released)return;released=true;if(s.creationSnapshot===snapshot)delete s.creationSnapshot;pruneMemes(s);
          }}};
        }},()=>{generationCounters.providerRequests++;});
    selectCatalog(s);
    s.service = new AnalysisService(analysisSessions, config, graph, resolver, gateway, s.catalogAssets, asset => permitted(s,asset));
    return s;
  }
  const handle = async (req:IncomingMessage,res:ServerResponse) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    let responseChatId:string|undefined;
    const send = (status: number, value: unknown) => { if (!res.destroyed) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value,responseChatId?(key,value)=>scopedDemoMedia(key,value,responseChatId!):undefined)); } };
    try {
      requireVisual(origin && req.headers.host === new URL(origin).host && req.socket.remoteAddress === "127.0.0.1", "permission-denied");
      const url = new URL(req.url ?? "/", origin);
      requireVisual(url.origin === origin, "permission-denied");
      const chatId=url.searchParams.get("chatId");
      if(url.search)requireVisual(sharedDemo&&url.searchParams.size===1&&validDemoChatId(chatId),"permission-denied");
      const path = url.pathname === "/" ? "/chat" : url.pathname;
      if(sharedDemo&&path.startsWith("/local/")){
        requireVisual(validDemoChatId(chatId),"processing-review-required");responseChatId=chatId;
      }
      if (req.method === "GET" && path === "/healthz") return send(200, { ready: true, scope: "local-development", ...(sharedDemo?{sharedDemo:true}:{}),sessionClose:true, sessionAdmission:direct?"no-count-quota":"legacy-four", model: !gateway.isSuspended(),
        imageGeneration:generationCapability.reason?"disabled":generationReadiness(loadGenerationProfile(options.generation?.profile),options.generation?.admission).mode,
        imageGenerationScope:"configuration-only",imageGenerationProbe:"not-performed",
        ...(webCreation?{webImageSearch:{...searchState,scope:"configuration-only"}}:{}) });
      if (req.method === "GET" && staticFiles.has(path)) {
        const file = staticFiles.get(path)!; res.writeHead(200, { "Content-Type": file.mime }); res.end(file.bytes); return;
      }
      const cookie = new RegExp(`(?:^|; )${cookieName()}=([A-Za-z0-9_-]{43})(?:;|$)`).exec(req.headers.cookie ?? "")?.[1];
      const roomKey=sharedDemo?`chat:${chatId}`:cookie;
      let s = roomKey ? sessions.get(roomKey) : undefined;
      if (s && s.expiresAt <= Date.now()) { retire(roomKey!,s);s = undefined; }
      if (req.method === "GET" && (path.startsWith("/local/assets/") || path.startsWith("/local/generated/") || path.startsWith("/local/memes/"))) {
        requireVisual(s && (!req.headers.origin || req.headers.origin === origin)
          && (!req.headers["sec-fetch-site"] || req.headers["sec-fetch-site"] === "same-origin"), "permission-denied");
        if(path.startsWith("/local/memes/")){
          const match=/^\/local\/memes\/([A-Za-z0-9_-]{43})\/(imgflip-[0-9]{1,15}|web-[A-Za-z0-9_-]{43})\.png$/.exec(path);
          const snapshot=match?s.memeSnapshots.get(match[1]):undefined,file=match?snapshot?.read(match[2]):undefined;
          requireVisual(snapshot&&file,"asset-rights-unavailable");
          const release=snapshot.retain();res.once("finish",release);res.once("close",release);
          res.writeHead(200,{"Content-Type":"image/png"});res.end(file.preview);return;
        }
        if (path.startsWith("/local/generated/")) {
          const match=/^\/local\/generated\/([A-Za-z0-9_-]{43})\/(poster|image|animation)$/.exec(path);
          requireVisual(match,"permission-denied"); const file=s.generation.serve(match[1],match[2]);
          res.once("finish",file.release);res.once("close",file.release);
          res.writeHead(200,{"Content-Type":file.mime}); res.end(file.bytes); return;
        }
        const match = /^\/local\/assets\/([a-z-]+)\/(still|animation)$/.exec(path);
        const file = match ? catalog.read(match[1], match[2]) : undefined; requireVisual(file, "asset-rights-unavailable");
        res.writeHead(200, { "Content-Type": file.mime }); res.end(file.bytes); return;
      }
      requireVisual(req.method === "POST" && req.headers.origin === origin
        && (!req.headers["sec-fetch-site"] || req.headers["sec-fetch-site"] === "same-origin"), "permission-denied");
      const body = await readBody(req);
      // Body reads yield: concurrent first joins must converge on one room.
      if(sharedDemo){
        s=sessions.get(roomKey!);
        if(s&&s.expiresAt<=Date.now()){retire(roomKey!,s);s=undefined;}
      }
      if (path === "/local/session") {
        if(sharedDemo)requireVisual(Object.keys(body).length===0,"processing-review-required");
        if (!s) {
          s = newSession(sharedDemo?chatId!:undefined); const id = sharedDemo?roomKey!:opaque(); sessions.set(id, s);
          if(!sharedDemo)res.setHeader("Set-Cookie", `${cookieName()}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`);
        }
        return send(200, { ...state(s), csrf: s.csrf, catalog: { digest: catalog.digest, assets: catalog.review } });
      }
      requireVisual(s && req.headers["x-local-csrf"] === s.csrf, "auth-required");
      if(path==="/local/session/close"){
        requireVisual(Object.keys(body).length===0,"permission-denied");
        if(sharedDemo)return send(200,{closed:true,roomPreserved:true});
        retire(roomKey!,s);
        res.setHeader("Set-Cookie",`${cookieName()}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
        return send(200,{closed:true});
      }
      if (path === "/local/state") return send(200, state(s));
      if (path === "/local/reset") {
        if(sharedDemo)requireVisual(body.revision===s.revision&&body.confirmSharedReset===true,"processing-review-required");
        erase(s); return send(200, state(s));
      }
      if (path === "/local/cancel") { invalidate(s); return send(200, state(s)); }
      if(path==="/local/speaker"){
        generationObject(body,["speaker"]);const speaker=text(body.speaker,40).trim();requireVisual(speaker,"processing-review-required");
        invalidate(s);s.outgoingSpeaker=speaker;return send(200,state(s));
      }
      if(path==="/local/speaker/profile"){
        generationObject(body,["revision","speaker","profile"]);
        requireVisual(body.revision===s.revision,"processing-review-required");
        const speaker=text(body.speaker,40).trim();requireVisual(speaker&&(body.profile===null||validSpeakerProfile(body.profile)),"processing-review-required");
        requireVisual(body.profile===null||s.profiles.has(speaker)||s.profiles.size<16,"local-profile-capacity");
        invalidate(s);
        if(body.profile===null)s.profiles.delete(speaker);else s.profiles.set(speaker,structuredClone(body.profile as SpeakerProfile));
        return send(200,state(s));
      }
      if (path === "/local/preview/cancel") { delete s.preview; s.generation.clearPreview(); return send(200, state(s)); }
      if(path==="/local/generation/batch/status"||path==="/local/generation/batch/process"){
        requireVisual(creationChoices,"permission-denied");
        generationObject(body,path.endsWith("/status")?["batchId"]:["batchId","digest","attempt","consent",...(mixedCreation?["allowMissingSource"]:[])]);
        const id=generationText(body.batchId,100,true),current=s.generation.batchStatus(id);
        if(path.endsWith("/status"))return send(200,current);
        requireVisual(!s.busy||current.status==="running","busy");
        const started=s.generation.startBatch(id,generationText(body.digest,100,true),body.attempt,body.consent===true,body.allowMissingSource===true);
        if(started.work){
          const session=s;session.busy=true;
          const work=started.work.finally(()=>{session.busy=false;collectRetired();});
          requests.add(work);void work.finally(()=>{requests.delete(work);});
        }
        return send(200,started.status);
      }
      if (path === "/local/generation/status" || path === "/local/generation/process") {
        generationObject(body,path.endsWith("/status")?["operationId"]:["operationId","digest","consent"]);
        const id=generationText(body.operationId,100,true);
        if(path.endsWith("/status")) return send(200,s.generation.status(id));
        const current=s.generation.status(id);
        if(current.status!=="reviewed") {
          requireVisual(body.digest===current.digest,"processing-review-required");return send(200,current);
        }
        requireVisual(!s.busy,"busy"); const session=s; s.busy=true;
        const disconnected=()=>{if(!res.writableEnded)invalidate(session);};res.once("close",disconnected);
        try { return send(200,await s.generation.process(id,generationText(body.digest,100,true),body.consent===true)); }
        finally {s.busy=false;res.off("close",disconnected);}
      }
      requireVisual(body.revision === s.revision && (!s.busy || path==="/local/edit" || path==="/local/remove"), "processing-review-required");
      if(path==="/local/emoji/suggest"){
        requireVisual(emojiExpressions&&config.profile,"permission-denied");
        generationObject(body,["revision","draft"]);
        const draft=parseEmojiDraft(body.draft,s.messages);
        const request=buildEmojiExpression(draft,s.messages,config.profile,config.executionScope??"production",
          {role:"outgoing-speaker",source:"voluntary-local-report",profile:s.profiles.get(s.outgoingSpeaker)??null});
        const lease=localPaidLease.acquire(analysisInterval);
        invalidate(s);const session=s,version=s.revision,signal=s.analysis.abort.signal;
        s.busy=true;permits.add(request.review.digest);
        const disconnected=()=>{if(!res.writableEnded&&session.revision===version)invalidate(session);};res.once("close",disconnected);
        try{
          const output=await queryGateway.run(request.body,request.review,signal);
          requireVisual(!signal.aborted&&s.revision===version&&s.expiresAt>Date.now(),"cancelled");
          s.emojiSuggestions={id:opaque(),digest:request.review.digest,revision:version,replyTo:draft.replyTo,
            expiresAt:Math.min(s.expiresAt,Date.now()+300_000),options:validateEmojiOptions(output)};
        }finally{permits.delete(request.review.digest);lease.release();s.busy=false;res.off("close",disconnected);}
        return send(200,{suggestions:s.emojiSuggestions,state:state(s)});
      }
      if(path==="/local/emoji/selection"){
        requireVisual(emojiExpressions,"permission-denied");generationObject(body,["revision","id","digest","index","withText"]);
        const suggestions=s.emojiSuggestions;
        requireVisual(suggestions&&suggestions.revision===s.revision&&suggestions.expiresAt>Date.now()
          &&body.id===suggestions.id&&body.digest===suggestions.digest&&Number.isInteger(body.index)
          &&typeof body.index==="number"&&body.index>=0&&body.index<3&&typeof body.withText==="boolean","processing-review-required");
        const text=emojiInsertion(suggestions.options[body.index],body.withText);
        return send(200,{text});
      }
      if(path==="/local/catalog/source"){
        generationObject(body,["revision","source"]);requireVisual(direct&&(body.source==="internet"||body.source==="original-demo"),"processing-review-required");
        invalidate(s);s.catalogSource=body.source;
        if(body.source==="original-demo")delete s.memeCatalog;
        selectCatalog(s);pruneMemes(s);return send(200,state(s));
      }
      if(path==="/local/catalog/load"){
        generationObject(body,["revision"]);requireVisual(direct&&s.catalogSource==="internet","processing-review-required");
        invalidate(s);delete s.memeCatalog;selectCatalog(s);pruneMemes(s);
        s.busy=true;const version=s.revision,session=s,signal=s.analysis.abort.signal;
        const disconnected=()=>{if(!res.writableEnded)invalidate(session);};res.once("close",disconnected);
        try{
          const snapshot=await memes.load(signal);
          try{
            requireVisual(!signal.aborted&&version===s.revision&&s.expiresAt>Date.now(),"cancelled");
            requireVisual(withinRoomMediaBudget(ordinaryBytes(s)+(s.memeSnapshots.has(snapshot.version)?0:snapshot.bytes)+s.generation.bytes(),mediaPolicy),"request-byte-budget-exceeded");
          }catch(error){snapshot.release();throw error;}
          if(s.memeSnapshots.has(snapshot.version))snapshot.release();else s.memeSnapshots.set(snapshot.version,snapshot);
          s.memeCatalog=snapshot;selectCatalog(s);return send(200,state(s));
        }finally{s.busy=false;res.off("close",disconnected);}
      }
      if (path === "/local/generation/review") {
        generationObject(body,["revision","draftRevision","draft"]); invalidate(s);
        return send(200,s.generation.review(body.draft,body.draftRevision));
      }
      if(path==="/local/generation/batch/retry-review"){
        requireVisual(creationChoices,"permission-denied");
        generationObject(body,["revision","batchId","digest"]);
        return send(200,s.generation.renewBatch(generationText(body.batchId,100,true),generationText(body.digest,100,true)));
      }
      if(path==="/local/generation/batch/source/retry"){
        requireVisual(mixedCreation,"permission-denied");generationObject(body,["revision","batchId","digest"]);
        const session=s,version=s.revision;s.busy=true;
        const disconnected=()=>{if(!res.writableEnded&&session.revision===version)invalidate(session);};res.once("close",disconnected);
        try{return send(200,await s.generation.retryExisting(generationText(body.batchId,100,true),generationText(body.digest,100,true)));}
        finally{s.busy=false;res.off("close",disconnected);}
      }
      if(path==="/local/generation/batch/source/preview"){
        requireVisual(mixedCreation,"permission-denied");generationObject(body,["revision","batchId","digest","caption","speaker"]);
        return send(200,s.generation.previewExisting(generationText(body.batchId,100,true),generationText(body.digest,100,true),body.caption,body.speaker));
      }
      if(path==="/local/generation/batch/source/insert"){
        requireVisual(mixedCreation,"permission-denied");generationObject(body,["revision","handle"]);requireVisual(s.messages.length<40,"local-message-capacity");
        const preview=s.generation.insertExisting(generationText(body.handle,100,true));
        s.messages.push({id:opaque(),speaker:preview.speaker,text:preview.caption,visual:preview.visual,createdAt:Date.now()});
        invalidate(s);return send(200,state(s));
      }
      if(path==="/local/generation/batch/review"){
        requireVisual(creationChoices,"permission-denied");
        generationObject(body,["revision","draftRevision","draft","count","referenceMode"]);invalidate(s);
        const session=s,version=s.revision;s.busy=true;
        const disconnected=()=>{if(!res.writableEnded&&session.revision===version)invalidate(session);};res.once("close",disconnected);
        try{return send(200,await s.generation.reviewBatch(body.draft,body.draftRevision,body.count,body.referenceMode));}
        finally{s.busy=false;res.off("close",disconnected);}
      }
      if (path === "/local/generation/animate") {
        generationObject(body,["revision","assetId"]); s.busy=true; const session=s;
        const disconnected=()=>{if(!res.writableEnded)invalidate(session);};res.once("close",disconnected);
        try {return send(200,await s.generation.animate(generationText(body.assetId,100,true)));}
        finally {s.busy=false;res.off("close",disconnected);}
      }
      if (path === "/local/generation/preview") {
        generationObject(body,["revision","assetId","variant","caption","alt","speaker"]);
        return send(200,s.generation.previewInsert(generationText(body.assetId,100,true),body.variant,body.caption,body.alt,body.speaker));
      }
      if (path === "/local/generation/insert") {
        generationObject(body,["revision","handle"]);requireVisual(s.messages.length<40,"local-message-capacity");
        const id=opaque(), preview=s.generation.insert(generationText(body.handle,100,true),id);
        invalidate(s);s.messages.push({id,speaker:preview.speaker,text:preview.caption,generated:preview.generated,createdAt:Date.now()});return send(200,state(s));
      }
      if (path === "/local/catalog") {
        requireVisual(!direct,"processing-review-required");
        requireVisual(body.digest === catalog.digest && typeof body.accepted === "boolean", "asset-rights-unavailable");
        invalidate(s); s.attestation = body.accepted ? catalog.digest : undefined; return send(200, state(s));
      }
      if(path==="/local/demo"){
        generationObject(body,body.scenario===undefined?["revision","language"]:["revision","language","scenario"]);
        requireVisual((body.language==="en"||body.language==="zh-CN")&&s.messages.length===0,"processing-review-required");
        requireVisual(body.scenario===undefined||body.scenario==="film"||emojiExpressions&&(body.scenario==="emoji"||body.scenario==="combined"),"processing-review-required");
        invalidate(s);s.busy=true;const version=s.revision,session=s,signal=s.analysis.abort.signal;
        const disconnected=()=>{if(!res.writableEnded)invalidate(session);};res.once("close",disconnected);
        try{
          const authored=await localDemo(body.language,body.scenario==="combined"?"combined":body.scenario==="emoji"?"emoji":"film"),staged:Awaited<ReturnType<typeof prepareMessage>>[]=[];
          let stagedBytes=0;
          for(const item of authored){
            requireVisual(s.revision===version&&!signal.aborted,"cancelled");
            const value=await prepareMessage(s,item,stagedBytes);value.message.demoMedia=item.demoMedia;
            staged.push(value);stagedBytes+=value.bytesCount+(value.media?.samples.reduce((n,f)=>n+f.bytes,0)??0);
          }
          requireVisual(s.revision===version&&!signal.aborted&&s.messages.length===0,"cancelled");
          if(body.scenario==="combined"){
            const times=combinedDemoTimes();
            staged.forEach((value,i)=>{value.message.createdAt=times[i];value.message.demoTimeline=true;});
          }
          staged.forEach(value=>commitMessage(s,value));return send(200,state(s));
        }finally{s.busy=false;res.off("close",disconnected);}
      }
      if (path === "/local/message") {
        requireVisual(s.messages.length < 40, "local-message-capacity");
        invalidate(s);s.busy=true;const session=s;
        const disconnected=()=>{if(!res.writableEnded)invalidate(session);};res.once("close",disconnected);
        try{commitMessage(s,await prepareMessage(s,body));return send(200,state(s));}
        finally{s.busy=false;res.off("close",disconnected);}
      }
      if (path === "/local/edit" || path === "/local/remove") {
        const id = text(body.id, 100), message = s.messages.find(m => m.id === id); requireVisual(message, "processing-review-required");
        s.knownSources.delete(id);
        invalidate(s);
        if (path === "/local/remove") { s.generation.releaseMessage(id); s.messages = s.messages.filter(m => m.id !== id); s.media.delete(id); s.attachmentBytes.delete(id);pruneMemes(s); }
        else {
          const content = text(body.text, 2000), speaker = text(body.speaker, 40).trim();
          requireVisual(speaker && (content.trim() || message.attachment || message.visual || message.generated), "processing-review-required");
          message.text = content; message.speaker = speaker;
        }
        return send(200, state(s));
      }
      if (path === "/local/review") {
        requireVisual(body.command === "explainVisual" || body.command === "recommendVisual", "processing-review-required");
        const selected = s.messages.find(m => m.id === body.selectedId);
        requireVisual(body.command !== "explainVisual" || selected, "processing-review-required");
        if(direct&&body.command==="explainVisual")requireVisual(canExplainLocalMessage(selected),"local-visual-required");
        const inputBody = object(body.input);
        requireVisual(typeof inputBody.intent === "string" && Array.isArray(inputBody.context) && inputBody.preferences, "processing-review-required");
        const input: ReviewInput = { version: 0, intent: inputBody.intent, context: inputBody.context, preferences: inputBody.preferences as ReviewInput["preferences"] };
        const profileSpeaker=body.command==="explainVisual"?selected!.speaker:s.outgoingSpeaker;
        const speakerContext:SpeakerContext={role:body.command==="explainVisual"?"selected-sender":"outgoing-speaker",source:"voluntary-local-report",profile:s.profiles.get(profileSpeaker)??null};
        if(direct)input.speakerContext=speakerContext;
        requireVisual(Array.isArray(input.context) && input.context.length <= LOCAL_CONTEXT_REVIEW_LIMIT
          && input.context.every(c => c&&typeof c.included==="boolean"&&s!.messages.some(m => m.id === c.label)), "processing-review-required");
        requireVisual(localContextWithinLimit(input.context),"local-context-limit");
        invalidate(s); s.analysis.binding.commandId = body.command;
        s.analysis.media = body.command === "explainVisual" && selected ? s.media.get(selected.id) : undefined;
        if (body.command === "explainVisual" && selected?.visual) {
          const external=!!(selected.visual.template||selected.visual.webSource);
          const meme=external?s.memeSnapshots.get(selected.visual.version)?.read(selected.visual.id):undefined;
          const source=meme?{bytes:meme.analysis,mime:"image/png"}:external?undefined:catalog.read(selected.visual.id, selected.visual.animationUrl ? "animation" : "still");
          requireVisual(source && (meme||permission(s) === catalog.digest), "asset-rights-unavailable");
          s.busy = true; const version = s.revision;
          try {
            const media = await normalizeMedia([{ id: selected.id, bytes: source.bytes, mime: source.mime,
              category: selected.visual.category }], config.profile!, config.mediaLimits!, s.analysis.abort.signal, config.executionScope);
            requireVisual(s.revision === version && s.expiresAt>Date.now() && !s.analysis.abort.signal.aborted, "cancelled");
            s.analysis.media=media;
          } finally { s.busy = false; }
        }
        if(body.command==="explainVisual" && selected?.generated) {
          s.busy=true;const version=s.revision, signal=s.analysis.abort.signal;
          let source: Awaited<ReturnType<LocalGenerationSession["explainSource"]>> | undefined;
          try {
            source=await s.generation.explainSource(selected.generated,signal);
            const media=await normalizeMedia([{id:selected.id,bytes:source.bytes,mime:source.mime,category:source.category}],config.profile!,config.mediaLimits!,signal,config.executionScope);
            const compressed=source.bytes.length+media.samples.reduce((n,f)=>n+f.bytes,0);
            requireVisual(compressed<=generationLimits.explain && s.revision===version && s.expiresAt>Date.now() && !signal.aborted
              && s.messages.some(m=>m.id===selected.id && m.generated?.digest===selected.generated?.digest),"cancelled");
            const releaseSource=source.release;
            const cache:GeneratedCache={assetId:selected.generated.assetId,version:selected.generated.version,detached:false,inFlight:0,compressedBytes:compressed,
              snapshotBytes:JSON.stringify(media).length*2*4+modelRequestLimit(config.profile!)*2,owners:new Set(["analysis-media"]),
              release:()=>{releaseSource();cacheGroups.delete(cache);}};
            cacheGroups.add(cache);s.generatedCache=cache;
            s.analysis.media=media;source=undefined;
          } finally {source?.release();s.busy=false;}
        }
        if(direct&&body.command==="explainVisual"){
          if(hasLocalVisual(selected))requireVisual(s.analysis.media?.samples.length,"local-visual-required");
          input.explanationTarget=hasLocalVisual(selected)?selected?.demoMedia==="custom-emoji"
            ?{kind:"visual",originalCustomEmoji:true,contextLabel:input.context.some(c=>c.included&&c.label===selected.id)?selected.id:null}
            :{kind:"visual"}:{kind:"emoji",emoji:selectedEmoji(selected!.text)};
          s.explainMessageId=selected!.id;
        }
        const processing = s.service.review(s.analysis, input);
        s.generatedCache?.owners.add("processing");
        s.review = { processing, input: structuredClone(s.analysis.review!), media: structuredClone(s.analysis.media ?? { samples: [], coverage: [] }), revision: s.revision,...(direct?{profileSpeaker}:{}),
          ...(s.generatedCache?{generatedSource:{assetId:s.generatedCache.assetId,version:s.generatedCache.version,sourceSide:512,analysisSide:128}}:{}),
          ...(s.analysis.candidatePool ? { catalog: s.analysis.candidatePool.map(a => ({ id: a.public.id, alt: a.public.alt, category: a.public.category, tags: a.tags })) } : {}) };
        s.generatedCache?.owners.add("local-review");
        return send(200, s.review);
      }
      if (path === "/local/process") {
        requireVisual(body.consent === true && s.review && s.review.processing.digest === body.digest, "processing-review-required");
        if(direct&&s.analysis.binding.commandId==="explainVisual"){
          const selected=s.messages.find(m=>m.id===s.explainMessageId);
          requireVisual(canExplainLocalMessage(selected)&&(!hasLocalVisual(selected)||s.analysis.media?.samples.length),"local-visual-required");
        }
        requireVisual(!localPaidLease.busy && Date.now() >= Math.max(cooldownUntil,localPaidLease.nextAt), "busy");
        const lease=localPaidLease.acquire(analysisInterval),cache=s.generatedCache;
        if(cache){cache.inFlight++;cache.owners.delete("processing");}
        const reviewed = s.review, session = s; s.busy = true; delete s.preview;
        permits.add(reviewed.processing.digest);
        const disconnected = () => { if (!res.writableEnded) invalidate(session); };
        res.once("close", disconnected);
        try {
          const result = await s.service.process(s.analysis, reviewed.processing.digest);
          requireVisual(s.revision === reviewed.revision, "cancelled");
          if(result.status==="ready"&&result.kind==="explanation"&&s.explainMessageId){
            const background=result.explanation.background;
            if(background.source&&background.context)s.knownSources.set(s.explainMessageId,{source:background.source,context:background.context});
            else s.knownSources.delete(s.explainMessageId);
          }
          return send(200, { result, state: state(s) });
        } finally {
          lease.release(); if(cache){cache.inFlight--;if(cache.detached&&!cache.inFlight)cache.release();}
          permits.delete(reviewed.processing.digest); s.busy = false; if(s.review===reviewed){delete s.review;cache?.owners.delete("local-review");} res.off("close", disconnected);
        }
      }
      if (path === "/local/preview") {
        delete s.preview;
        const result = s.analysis.result; requireVisual(result?.status === "ready" && result.kind === "recommendations", "share-review-required");
        const candidate = result.candidates.find(c => c.visual.id === body.id);
        requireVisual(candidate && s.catalogAssets.some(a=>a.public.id===candidate.visual.id&&permitted(s,a)), "asset-rights-unavailable");
        const speaker = text(body.speaker, 40).trim(); requireVisual(speaker, "share-review-required");
        s.preview = { handle: opaque(), visual: structuredClone(candidate.visual), caption: text(body.caption, 500), speaker };
        return send(200, s.preview);
      }
      if (path === "/local/insert") {
        requireVisual(s.preview && body.handle === s.preview.handle && s.catalogAssets.some(a=>a.public.id===s!.preview!.visual.id&&permitted(s!,a)), "share-review-required");
        requireVisual(s.messages.length<40,"local-message-capacity");
        const preview = s.preview; invalidate(s);
        s.messages.push({ id: opaque(), speaker: preview.speaker, text: preview.caption, visual: preview.visual,createdAt:Date.now() });
        return send(200, state(s));
      }
      return send(404, { status: "blocked", code: "not-configured" });
    } catch (error) { send(400, error instanceof GenerationError ? {status:"blocked",code:error.code,
      ...(error.planningReason?{planningReason:error.planningReason}:{}),...(error.planningIssues?{planningIssues:error.planningIssues}:{})} : failure(error)); }
  };
  const server=createServer({requestTimeout:20_000,headersTimeout:10_000},(req,res)=>{
    const request=handle(req,res);requests.add(request);void request.finally(()=>{requests.delete(request);collectRetired();});
  });
  return {
    counters, generationCounters,memeCounters:memes.counters,
    async operatorCanary(csrf:string,operationId:string,digest:string){
      const s=[...sessions.values()].find(session=>session.csrf===csrf);
      requireVisual(s&&!s.busy,"permission-denied");
      if(s.generation.readiness().mode!=="validation-only")throw new GenerationError("validation-only-not-browser-ready");
      s.busy=true;
      try{const result=await s.generation.process(operationId,digest,true,true);return {result,metrics:s.generation.operatorMetrics()};}
      finally{s.busy=false;}
    },
    resources:()=>({ordinaryMediaBytes:[...sessions.values(),...retiring].reduce((n,s)=>n+ordinaryBytes(s),0),memeBytes:memes.retainedBytes,sessions:sessions.size,retiringSessions:retiring.size,generatedBytes:[...sessions.values(),...retiring].reduce((n,s)=>n+s.generation.bytes(),0),cacheGroups:cacheGroups.size,
      cacheSnapshotUpperBound:[...cacheGroups].reduce((n,c)=>n+c.snapshotBytes,0),nativeBusy:generatedWorkerLease.busy,paidBusy:localPaidLease.busy}),
    async start(port = 4317) {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; return origin;
    },
    async close() {
      clearInterval(timer); for (const s of [...sessions.values(),...retiring]) erase(s);analysisSessions.dispose();
      config.modelKey = undefined;
      const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();
      await Promise.all([closed,Promise.allSettled([...requests])]);
      sessions.clear();retiring.clear();
    }
  };
}
