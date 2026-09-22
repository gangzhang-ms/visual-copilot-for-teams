import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Language } from "../shared/types";
import type { CreationChoice, ExistingGenerationCandidate, GenerationBatchOptions, GenerationInspiration, LocalGenerationBatch, LocalGenerationBatchReview, LocalGeneratedInsertPreview, LocalGeneratedVisual, LocalGenerationDraft, LocalGenerationReview, LocalGenerationStatus, LocalInsertPreview, LocalState } from "../shared/local-chat";
import {localOutputCaptionLimit} from "../shared/local-chat";
import {PublicArtwork,PublicNotices} from "./LocalPublicVisual";
import { localRequest,LocalRequestError,beginLocalWork,ensureLocalSpeaker } from "./local-chat-api";
import {expressionStyles,replyVisualStyles,type ExpressionOptions} from "../shared/expression";
import {friendlyLocalError} from "./friendly-local-error";
import {emptyCreativeDraft,sharedCreativeDraft,type ExpressionDraft} from "./UnifiedExpression";
import {deriveWebSearchTerms} from "../shared/web-search-terms";
function InspirationDetails({value,language}:{value:GenerationInspiration;language:Language}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  return <details className="generation-inspiration"><summary>{t("Online inspiration (text only)","网络灵感（仅文字）")}</summary>
    <p>{value.provider==="Google Images via SerpApi"?t("Google Images via SerpApi, not an official Google API. Source titles are text inspiration, not image-pixel conditioning or rights clearance.","通过 SerpApi 搜索 Google 图片，并非 Google 官方 API。来源标题仅作文字灵感，不是图像像素参考或权利许可。"):value.provider==="Wikimedia Commons"?t("Wikimedia Commons shared media library, not whole-web or trending-meme search. AI images receive result titles, not reference-image pixels.","维基共享资源素材库，不是全网或热门表情搜索。AI 图像接收结果标题，不接收参考图像素。"):value.provider==="Brave"?t("Brave web image search. Image generation receives only result titles and text metadata, not source pixels. Search coverage and source rights are not guaranteed.","Brave 网络图片搜索。图像生成仅接收结果标题与文字元数据，不接收来源像素；不保证搜索覆盖或素材权利。"):t("Imgflip's public popular-template list, not a whole-web trend search. Only template names, editorial expression patterns and the fetch time are sent to the image model. No reference pixels are sent.","使用 Imgflip 公开热门模板列表，不是全网趋势搜索。仅向图像模型发送模板名称、编辑整理的表达模式和获取时间，不发送参考图像素。")}</p>
    <p>{value.selection==="model-semantic-match"?t("AI matched the reviewed description, context and preferences against public template metadata. It did not inspect source pixels.","AI 根据已审阅的描述、上下文与偏好选择公开模板元数据，没有查看来源像素。"):value.selection==="popular-fallback"?t("No keyword match: popular templates are offered as optional inspiration, not claimed as a relevant match.","没有关键词匹配：提供热门模板作为可选灵感，不宣称与意图匹配。"):t("Selected locally by keyword overlap; the model is asked to use only patterns that fit your description.","根据关键词在本地筛选，要求模型仅使用符合你描述的表达模式。")}</p>
    <ul>{value.references.map(reference=><li key={reference.sourceUrl}><a href={reference.sourceUrl} target="_blank" rel="noreferrer">{reference.name}</a><p>{reference.pattern}</p></li>)}</ul>
    <p>{t("Fetched","获取时间")}: {new Date(value.fetchedAt).toLocaleString(language)}. {value.provider==="Google Images via SerpApi"?t("Only search keywords go to SerpApi, not full chat or profiles. SafeSearch is requested; creator/license remain unverified.","仅向 SerpApi 发送搜索词，不发送完整聊天或偏好。已请求安全搜索，作者与许可仍未核实。"):value.provider==="Wikimedia Commons"?t("Only the displayed terms go to Wikimedia, never chat or profiles. Check each file's attribution and license; no strict SafeSearch guarantee.","仅向维基发送显示的搜索词，不发送聊天或偏好。请检查每个文件的署名和许可；不保证严格安全搜索。"):value.provider==="Brave"?t("Brave receives only the displayed search terms, not chat or profiles. Public access grants no reuse rights.","Brave 仅接收显示的搜索词，不接收聊天或偏好。公开可访问不代表获得使用权。"):t("No private description, conversation or profile is sent to Imgflip. Public access does not grant reuse or redistribution rights.","不会将私有描述、对话或偏好发送给 Imgflip。公开可访问不代表获得使用或再分发权利。")}</p>
  </details>;
}
function pausePolling(signal:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new DOMException("Cancelled","AbortError"));};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},400);
    if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});
  });
}
export function GeneratedArtwork({ visual, language,showDetails=true }: { visual: LocalGeneratedVisual; language: Language;showDetails?:boolean }) {
  const [playing,setPlaying]=useState(false);
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  useEffect(()=>{setPlaying(false);const reduced=matchMedia("(prefers-reduced-motion: reduce)");
    const stop=()=>setPlaying(false);reduced.addEventListener("change",stop);return()=>reduced.removeEventListener("change",stop);
  },[visual.assetId,visual.digest,visual.variant]);
  return <figure className="generated-artwork">
    <img className="local-art" src={playing?visual.mediaUrl:visual.posterUrl} alt={visual.alt} />
    {visual.variant==="animation" && <button type="button" aria-pressed={playing} onClick={()=>setPlaying(v=>!v)}>{playing?t("Stop animation","停止动画"):t("Play animation","播放动画")}</button>}
    {showDetails&&<figcaption><GeneratedMediaDetails visual={visual} language={language}/></figcaption>}
  </figure>;
}
export function GeneratedMediaDetails({visual,language,technical=true}:{visual:LocalGeneratedVisual;language:Language;technical?:boolean}){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  return <><strong>{visual.method==="generated-image-local-animation"?t("Generated still + local pan/zoom. Not generated actions or video.","AI 生成静图 + 本地平移缩放，不是生成动作或视频。"):t("AI-generated still image","AI 生成静态图片")}</strong>
      {technical&&<><p>{t("Model / version","模型 / 版本")}: {visual.model} / {visual.modelVersion}</p>
      <p>{t("512px rendition downsampled from a 1024px generated still.","从 1024 像素生成静图缩小得到的 512 像素版本。")}
        {visual.variant==="animation"&&t(" Local GIF uses a white matte and a fixed 125-color palette; detail and color are reduced."," 本地 GIF 使用白色底与固定 125 色，细节和色彩有所减少。")}</p></>}
      <p>{t("Pending human and rights review. Local test use only; no public redistribution approval. Provider terms still apply.","等待人工与权利审阅。仅限本地测试，不代表公开再分发许可；仍适用提供商条款。")}</p>
      <p>{t("Description","描述")}: {visual.alt}</p>
      {visual.inspiration&&<InspirationDetails value={visual.inspiration} language={language}/>}
      {technical&&<small>{visual.width}×{visual.height}{visual.variant==="animation"?" · 12 frames · 1.2s · pan-zoom-v1":""} · {t("Content hash","内容摘要")}: {visual.digest}</small>}
  </>;
}
function CreationOptions({simple,summary,children}:{simple:boolean;summary:ReactNode;children:ReactNode}){
  return simple?<details className="creation-advanced"><summary>{summary}</summary>{children}</details>:<>{children}</>;
}
type Props={room:LocalState;language:Language;speaker:string;onState:(state:LocalState)=>void;
  shared?:{common:ExpressionDraft;options:LocalGenerationDraft;onOptions:(draft:LocalGenerationDraft)=>void;onWork:()=>void;
    batchOptions?:GenerationBatchOptions;onBatchOptions?:(options:GenerationBatchOptions)=>void;
    advanced:ReactNode;blocked:boolean;onReset:()=>void}};
export function LocalGenerationPanel({room,language,speaker,onState,shared}:Props) {
  const direct=room.interaction==="direct-personal";
  const simple=direct&&!!shared;
  const choices=direct&&room.creationChoices===true;
  const mixed=choices&&room.mixedCreation===true;
  const web=!!room.webCreation;
  const commons=room.webCreation?.provider==="Wikimedia Commons";
  const serp=room.webCreation?.provider==="Google Images via SerpApi";
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  const contexts=()=>room.messages.slice(-12).map(m=>({label:m.id,text:`${m.speaker}: ${m.text}`.slice(0,2000),included:false}));
  const [localDraft,setDraft]=useState<LocalGenerationDraft>({intent:"",creative:"",output:"image",context:contexts(),expression:{style:"reaction-sticker",intensity:"balanced",reference:""},
    preferences:{source:"requester-reported",language,culture:"",familiarity:"",tone:"",relationship:"",humor:"",avoid:""}});
  const sourceDraft=shared?sharedCreativeDraft(shared.options,shared.common,language):localDraft;
  const draft=room.contextualCreation&&sourceDraft.expression&&sourceDraft.expression.culturalMode===undefined
    ?{...sourceDraft,expression:{...sourceDraft.expression,culturalMode:sourceDraft.expression.reference.trim()?"explicit" as const:"follow-conversation" as const}}
    :sourceDraft;
  const [review,setReview]=useState<LocalGenerationReview>(),[operation,setOperation]=useState<LocalGenerationStatus>();
  const [batch,setBatch]=useState<LocalGenerationBatch>(),[localBatchOptions,setLocalBatchOptions]=useState<GenerationBatchOptions>({count:3,referenceMode:"popular-text"});
  const batchOptions=shared?.batchOptions??localBatchOptions,{count,referenceMode}=batchOptions;
  const setBatchOptions=(value:GenerationBatchOptions)=>shared?.onBatchOptions?shared.onBatchOptions(value):setLocalBatchOptions(value);
  const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [planningReason,setPlanningReason]=useState<LocalRequestError["planningReason"]>();
  const [planningIssues,setPlanningIssues]=useState<LocalRequestError["planningIssues"]>();
  const [variant,setVariant]=useState<"image"|"animation">("image"),[caption,setCaption]=useState(""),[alt,setAlt]=useState("");
  const [checked,setChecked]=useState(false),[preview,setPreview]=useState<LocalGeneratedInsertPreview>();
  const [selectedExisting,setSelectedExisting]=useState<Extract<ExistingGenerationCandidate,{status:"ready"}>>();
  const [existingPreview,setExistingPreview]=useState<LocalInsertPreview>();
  const epoch=useRef(0),draftRevision=useRef(0),alive=useRef(true),controller=useRef<AbortController|undefined>(undefined);
  const directFlight=useRef<symbol|undefined>(undefined);
  const cancellationFailure=useRef<number|undefined>(undefined);
  const acceptedRevision=useRef(room.revision),roomRef=useRef(room),cancelQueue=useRef(Promise.resolve());
  const insertionEpoch=useRef(0);
  const pendingPreview=useRef<Promise<LocalGeneratedInsertPreview>|undefined>(undefined);
  const pendingExistingPreview=useRef<Promise<LocalInsertPreview>|undefined>(undefined);
  roomRef.current=room;
  const fresh=(id:number)=>alive.current&&id===epoch.current;
  const adopt=(value:LocalState)=>{acceptedRevision.current=value.revision;roomRef.current=value;onState(value);};
  const clear=()=>{epoch.current++;controller.current?.abort();setReview(undefined);setOperation(undefined);setBatch(undefined);setPreview(undefined);setExistingPreview(undefined);setSelectedExisting(undefined);setConsent(false);setChecked(false);setBusy(false);setError("");};
  useLayoutEffect(()=>{if(acceptedRevision.current!==room.revision){acceptedRevision.current=room.revision;clear();}},[room.revision]);
  useLayoutEffect(()=>{if(shared)clear();},[shared?.common.version]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;controller.current?.abort();};},[]);
  async function work(run:(signal:AbortSignal,id:number)=>Promise<void>) {
    const finish=beginLocalWork();
    shared?.onWork();
    const id=++epoch.current,c=new AbortController();controller.current=c;setBusy(true);setError("");setPlanningReason(undefined);setPlanningIssues(undefined);
    try {await run(c.signal,id);} catch(e) {if(fresh(id)&&!c.signal.aborted){setError(e instanceof Error?e.message:"generation-failed");setPlanningReason(e instanceof LocalRequestError?e.planningReason:undefined);setPlanningIssues(e instanceof LocalRequestError?e.planningIssues:undefined);}}
    finally {finish();if(fresh(id)){setBusy(false);if(controller.current===c)controller.current=undefined;}}
  }
  function revoke() {
    const needsCancel=!!review||!!operation||!!batch||busy;
    clear();draftRevision.current++;
    if(!needsCancel)return;
    const id=epoch.current;setBusy(true);
    cancelQueue.current=cancelQueue.current.then(async()=>{
      try {const value=await localRequest<LocalState>("cancel");if(fresh(id))adopt(value);}
      catch(e){if(fresh(id)){cancellationFailure.current=id;setError(e instanceof Error?e.message:"generation-failed");}}
      finally{if(fresh(id))setBusy(false);}
    });
  }
  function edit(change:Partial<LocalGenerationDraft>){revoke();if(shared)shared.onOptions({...shared.options,...change});else setDraft(d=>({...d,...change}));}
  function clearPreview() {
    insertionEpoch.current++;setPreview(undefined);setExistingPreview(undefined);
    const pending=pendingPreview.current,sourcePending=pendingExistingPreview.current;if(!preview&&!pending&&!existingPreview&&!sourcePending)return;
    const id=epoch.current,ticket=insertionEpoch.current;
    cancelQueue.current=Promise.allSettled([cancelQueue.current,...(pending?[pending]:[]),...(sourcePending?[sourcePending]:[])]).then(async()=>{
      try{await localRequest("preview/cancel");}catch(e){if(fresh(id)&&ticket===insertionEpoch.current)setError(e instanceof Error?e.message:"generation-failed");}
    });
  }
  const previousLanguage=useRef(language),previousSpeaker=useRef(speaker);
  useEffect(()=>{if(previousLanguage.current!==language){previousLanguage.current=language;revoke();setDraft(d=>({...d,preferences:{...d.preferences,language}}));}},[language]);
  useEffect(()=>{if(previousSpeaker.current!==speaker){previousSpeaker.current=speaker;revoke();}},[speaker]);
  async function prepare() {
    revoke();
    const requestedEpoch=epoch.current;
    await cancelQueue.current;
    if(!fresh(requestedEpoch))return;
    void work(async(signal,id)=>{
      let latest=await localRequest<LocalState>("state",{},signal);if(!fresh(id))return;
      latest=await ensureLocalSpeaker(latest,speaker,signal);if(!fresh(id))return;adopt(latest);
      const submitted=structuredClone({...draft,preferences:{...draft.preferences,language}});
      const value=await localRequest<LocalGenerationReview>("generation/review",{revision:roomRef.current.revision,draftRevision:draftRevision.current,draft:submitted},signal);
      if(!fresh(id))return;adopt({...roomRef.current,revision:value.revision});setReview(value);
    });
  }
  async function processReviewed(review:LocalGenerationReview,signal:AbortSignal,id:number) {
    const known={operationId:review.operationId,digest:review.digest,status:"dispatching" as const};
    setOperation(known);setConsent(false);
    try {
      const value=await localRequest<LocalGenerationStatus>("generation/process",{operationId:known.operationId,digest:known.digest,consent:true},signal);
      if(!fresh(id))return;setOperation(value);setReview(undefined);if(value.image)setAlt(value.image.alt);setVariant(value.animation?"animation":"image");
      const state=await localRequest<LocalState>("state",{},signal);if(fresh(id))adopt(state);
    } catch(e){if(fresh(id)&&!signal.aborted){setReview(undefined);setOperation({...known,status:"unknown-after-dispatch"});}throw e;}
  }
  async function generate() {
    if(!review||!consent||!review.dispatchable||operation)return;
    void work((signal,id)=>processReviewed(review,signal,id));
  }
  async function observeBatch(value:LocalGenerationBatch,signal:AbortSignal,id:number){
    while(fresh(id)){
      setBatch(value);
      if(value.status!=="running")break;
      await pausePolling(signal);
      value=await localRequest<LocalGenerationBatch>("generation/batch/status",{batchId:value.batchId},signal);
    }
    if(fresh(id)){const state=await localRequest<LocalState>("state",{},signal);if(fresh(id))adopt(state);}
  }
  async function processBatch(value:LocalGenerationBatch,signal:AbortSignal,id:number,allowMissingSource=false){
    setBatch({...value,status:"running"});
    const started=await localRequest<LocalGenerationBatch>("generation/batch/process",{batchId:value.batchId,digest:value.digest,attempt:value.nextAttempt,consent:true,...(mixed?{allowMissingSource}: {})},signal);
    if(fresh(id))await observeBatch(started,signal,id);
  }
  async function retryBatch(allowMissingSource=false){
    if(!batch||busy||directFlight.current)return;
    const flight=Symbol();directFlight.current=flight;
    try{await work(async(signal,id)=>{
      const reviewed=await localRequest<LocalGenerationBatchReview>("generation/batch/retry-review",{revision:roomRef.current.revision,batchId:batch.batchId,digest:batch.digest},signal);
      if(fresh(id)){setBatch(reviewed);await processBatch(reviewed,signal,id,allowMissingSource);}
    });}finally{if(directFlight.current===flight)directFlight.current=undefined;}
  }
  async function createDirect(referenceOverride?:"none"){
    if(!direct||directFlight.current||busy||shared?.blocked||!draft.intent.trim()||!room.generation?.ready)return;
    const flight=Symbol(),submitted=structuredClone({...draft,...(web&&!serp?{searchTerms:draft.searchTerms??deriveWebSearchTerms(draft.intent)}:{}),preferences:{...draft.preferences,language}});
    directFlight.current=flight;revoke();setBusy(true);
    const requestedEpoch=epoch.current;
    try{
      await cancelQueue.current;
      if(!fresh(requestedEpoch)||cancellationFailure.current===requestedEpoch)return;
      await work(async(signal,id)=>{
        let latest=await localRequest<LocalState>("state",{},signal);if(!fresh(id))return;
        if(latest.revision!==roomRef.current.revision){adopt(latest);throw new Error("generation-stale");}
        latest=await ensureLocalSpeaker(latest,speaker,signal);if(!fresh(id))return;adopt(latest);
        if(choices){
          let value:LocalGenerationBatchReview;
          try{value=await localRequest<LocalGenerationBatchReview>("generation/batch/review",{revision:latest.revision,draftRevision:draftRevision.current,draft:submitted,count,referenceMode:referenceOverride??referenceMode},signal);}
          catch(error){
            if(fresh(id)&&!signal.aborted){const state=await localRequest<LocalState>("state",{},signal);if(fresh(id))adopt(state);}
            throw error;
          }
          if(!fresh(id))return;adopt({...latest,revision:value.revision});setBatch(value);
          if(!value.requests.every(request=>request.dispatchable))throw new Error("generation-busy");
          await processBatch(value,signal,id);return;
        }
        const value=await localRequest<LocalGenerationReview>("generation/review",{revision:latest.revision,draftRevision:draftRevision.current,draft:submitted},signal);
        if(!fresh(id))return;adopt({...latest,revision:value.revision});
        if(!value.dispatchable||value.expiresAt<=Date.now()){
          const state=await localRequest<LocalState>("state",{},signal);if(!fresh(id))return;adopt(state);
          throw new Error(value.expiresAt<=Date.now()?"generation-review-required":state.generation?.reason??"generation-capability-unavailable");
        }
        await processReviewed(value,signal,id);
      });
    }finally{if(directFlight.current===flight)directFlight.current=undefined;}
  }
  const active=variant==="animation"?operation?.animation:operation?.image;
  const generating=busy&&(direct||!!operation&&["dispatching","rendering"].includes(operation.status));
  const unresolved=batch?.status==="running"||!!operation&&["dispatching","rendering","unknown-after-dispatch"].includes(operation.status);
  const reason=generating?"generation-busy":room.generation?.reason??"image-not-provisioned-or-authorized";
  const reasonText:Record<string,string>={
    "available":t("Image generation is ready. Review the exact request before generating.","图像生成已就绪。生成前可审阅确切请求。"),
    "generation-cooling-down":t("Azure service pacing: one image request per minute. Prepare again after this wait; there is no automatic retry.","Azure 服务限制：图像每分钟一次。等待后重新准备，不会自动重试。"),
    "generation-busy":t("Another AI request is using the shared worker. Try again after it completes.","另一个 AI 请求正在使用共享工作进程，请在完成后再试。"),
    "generation-operation-unresolved":t("A previous request is running or its completion is unresolved. Check its status; no automatic retry.","上次请求仍在运行或完成状态不明，请查询状态，不会自动重试。"),
    "generation-allowance-unavailable":t("The durable allowance cannot be verified. Generation is blocked; do not delete or recreate its ledger.","无法核验持久额度，已阻止生成。请勿删除或重建额度记录。"),
    "generation-approval-expired":t("This personal authorization has expired; restarting does not renew it.","本次个人授权已过期，重新启动不会续期。"),
    "image-not-provisioned-or-authorized":t("Image generation is not provisioned or authorized. Preparing a brief makes no model request.","图像生成尚未部署或授权。准备创作简报不会调用模型。"),
    "generation-approval-required":t("Operator approval and verified deployment evidence are missing. Browser consent cannot enable generation.","缺少操作员授权与部署证据。浏览器中的同意不能开启生成。"),
    "validation-only-not-browser-ready":t("Only an explicitly approved one-call operator canary is admitted, not browser generation.","仅允许明确授权的单次操作员验证，不允许浏览器生成。"),
    "generation-budget-exhausted":t("The finite approved call allowance is consumed. Status and local derivatives make no new image request.","有限调用额度已耗尽。查看状态或制作本地动画不会再次调用图像模型。"),
  };
  const statusText:Record<string,string>={
    reviewed:t("Brief reviewed","简报已审阅"),dispatching:t("Request sent. Cancellation cannot recall transmitted content.","请求已发送，取消无法撤回已经传输的内容。"),
    rendering:t("Rendering locally","正在本地渲染"),ready:t("Output ready for your inspection","输出等待你检查"),
    failed:t("Generation failed. No automatic retry.","生成失败，不会自动重试。"),cancelled:t("Cancelled","已取消"),expired:t("Review expired; prepare it again.","审阅已过期，请重新准备。"),
    "unknown-after-dispatch":t("Completion is uncertain. Check this operation's status; do not resubmit it.","完成情况不确定。请查询本次操作状态，不要重复提交。")
  };
  const selectedStyle=expressionStyles.find(s=>s.id===draft.expression?.style);
  const cards:CreationChoice[]=batch?[...(batch.existing&&batch.existing.status!=="skipped"?[batch.existing]:[]),...batch.candidates]:[];
  const imageRequestCount=mixed&&count===3?2:count;
  const creationInfo=choices&&<p className="local-muted">{t(`${imageRequestCount} sequential AI image request${imageRequestCount===1?"":"s"}. Your specified subjects and style take priority.`,`${imageRequestCount} 次逐张 AI 图像请求。你指定的主体与风格优先。`)}
    {serp&&!room.contextualCreation&&mixed&&count===3&&referenceMode==="popular-text"&&<p>{t("Google Images via SerpApi: up to one Azure keyword plan and one result selection, plus two AI image requests. Only public keywords are sent externally; the whole description/context/profile is never sent to SerpApi. No source pixels condition generation; attribution/rights remain unverified.","通过 SerpApi 搜索 Google 图片：至多一次 Azure 搜索词规划、一次选图，再加两次 AI 图像请求。仅向外发送公开搜索词，不向 SerpApi 发送完整描述、上下文或偏好。生成不接收来源像素；署名与权利仍需核实。")}</p>}
    {mixed&&!serp&&count===3&&referenceMode==="popular-text"&&(commons?t(" Wikimedia Commons searches its shared media library, not the whole web. No API key required. Up to one Azure text selection chooses a licensed result; only its Wikimedia thumbnail is downloaded. Caption stays beside the image. AI options use titles, not reference-image pixels. License/credit remain attached; Commons has no strict SafeSearch guarantee."," 维基共享资源搜索共享素材库，而非全网，无需 API key。至多一次 Azure 文本选图请求选择带许可信息的结果，仅下载维基缩略图。配文在图旁；AI 方案参考标题，不接收来源像素。保留署名与许可；维基不保证严格安全搜索。"):web?t(" Brave searches the web using the displayed short terms. Up to one Azure text selection chooses a result. Only a Brave-proxied PNG/JPEG preview is downloaded, not arbitrary original hosts or full-resolution images. Caption is editable adjacent text. AI images receive titles, not reference-image pixels."," Brave 使用显示的简短词语搜索网络，再由至多一次 Azure 文本选图请求选择结果。仅下载 Brave 代理的 PNG/JPEG 预览图，不访问任意原图主机或下载全分辨率原图。配文在图旁可编辑；AI 图片仅参考标题，不接收来源像素。"):t(" Plus one existing image from Imgflip. It is normalized, not AI redrawn; your description becomes an editable adjacent caption, not burned-in or AI-written text. The generated options use names and patterns, not reference-image pixels. This is a bounded popular catalog, not whole-web search."," 另从 Imgflip 选择一张现成图。本地规范化而非 AI 重绘；描述作为可编辑的图旁配文，不烧字，也不是 AI 撰写。生成方案仅接收名称与表达模式，不接收参考图像素。来源限热门目录，不是全网搜索。"))}
    {room.semanticCreation&&count===3&&referenceMode==="popular-text"&&t(" One text-model selection request is included when valid metadata is available; a manual search retry may make one more. No match or source failure does not stop the two image requests. Source-only retries never regenerate images."," 有效元数据可用时包含 1 次文本模型选图请求；手动重试搜索可能再请求 1 次。无匹配或来源失败不会阻止两个图像请求。仅重试搜索不会重新生成图片。")}
    {!mixed&&referenceMode==="popular-text"&&t(" On Generate, your description is matched locally against Imgflip's public popular-template catalog for text inspiration, not reference-image pixels or a whole-web search."," 点击生成时，根据你的描述在 Imgflip 公开热门模板列表中进行本地匹配，作为文字灵感，不使用参考图像素，也不是全网搜索。")}
    {mixed&&draft.output==="gif"&&t(" Only AI options receive local animation; the existing source stays still."," 仅 AI 方案添加本地动画，现成来源仍为静态图片。")}
  </p>;
  const choiceSummary=[
    selectedStyle&&selectedStyle.id!=="auto"?(language==="en"?selectedStyle.en:selectedStyle.zh):"",
    draft.expression?.intensity&&draft.expression.intensity!=="auto"?t({restrained:"Restrained",balanced:"Balanced",exaggerated:"Exaggerated"}[draft.expression.intensity],{restrained:"克制",balanced:"适中",exaggerated:"夸张"}[draft.expression.intensity]):"",
    draft.creative?t(`Details: ${draft.creative.slice(0,36)}`,`补充：${draft.creative.slice(0,36)}`):"",
    draft.expression?.reference?t(`Reference: ${draft.expression.reference.slice(0,36)}`,`参考：${draft.expression.reference.slice(0,36)}`):"",
    ["culture","familiarity","tone","relationship","humor","avoid"].some(k=>draft.preferences[k as keyof typeof draft.preferences])?t("Audience preferences","受众偏好"):"",
    draft.context.some(c=>c.included)?t(`${draft.context.filter(c=>c.included).length} context messages`,`${draft.context.filter(c=>c.included).length} 条上下文`):"",
    room.speakerProfiles?.some(p=>p.speaker===speaker)?t("Saved speaker preferences","已保存的发言者偏好"):""
  ].filter(Boolean);
  const outputPicker=<label>{t("Requested output","期望输出")}<select aria-label={t("Requested output","期望输出")} value={draft.output} onChange={e=>edit({output:e.target.value==="gif"?"gif":"image"})}>
    <option value="image">{simple?t("Image","图片"):t("New still image","新静态图片")}</option><option value="gif">{simple?"GIF":t("New still + local animated GIF","新静图 + 本地 GIF 动画")}</option></select></label>;
  return <section className="local-generation" aria-label={t("Create a new visual","创作新视觉内容")}>
    {room.contextualCreation&&draft.visualContextId&&<p className="local-muted reply-target-cue">{t("Replying to: ","回复对象：")}{room.messages.find(m=>m.id===draft.visualContextId)?.speaker}: {room.messages.find(m=>m.id===draft.visualContextId)?.text.slice(0,90)}</p>}
    {!simple&&<div className="generation-intro"><span className="local-eyebrow">{t("CREATE · NEW ORIGINAL VISUAL","创作 · 全新视觉内容")}</span>
      <h3>{t("Give your idea a shape","让想法拥有形状")}</h3>
      <p>{room.contextualCreation?t("Match selected conversation visuals and your intended reaction; explicit new subjects or styles take priority.","结合所选聊天图片表达你的意图；明确指定的新主体或风格优先。"):direct?t("Describe your idea and choose any conversation text to include. Chat pictures are not used for creation.","描述你的想法，并选择要参考的聊天文字。创作不会使用聊天中的图片。"):t("Describe a new image using only the text you choose. No chat attachments, OCR, hidden summarizer, or inferred cultural profile are sent.","只使用你选择的文字来描述新图片，不发送聊天附件，不运行 OCR 或隐藏摘要模型，也不推断文化身份。")}</p></div>}
    <div className="generation-readiness" data-testid="generation-readiness"><strong>{direct?(reason==="generation-busy"?t("Creation is in progress","正在创作"):room.generation?.ready?t("Ready to create","可以开始创作"):t("Creation is not ready yet","暂时无法开始创作")):room.generation?.ready?t("Authorized finite run","已授权的有限运行"):t("Generation unavailable","生成暂不可用")}</strong>
      {(!simple||reason!=="available")&&<p>{direct?(reason==="available"?t("Choose a style, then generate when ready.","选择风格，准备好后点击生成。"):friendlyLocalError(reason,language)):reasonText[reason]??reason}</p>}
      {!direct&&<p>{t("Approved image calls remaining","剩余已授权图像调用")}: {room.generation?.remainingCalls??0}</p>}
      {!direct&&room.generation?.durable&&<p>{t("Personal development only: three ordinary attempts total, persisted across browser/server restarts. Dispatched failures and cancellation consume an attempt. Minimum 61 seconds between image calls. This does not certify cultural meaning, retention, rights, or production readiness.","仅限个人开发：总计三次普通尝试，浏览器或服务器重启不恢复额度。已发送的失败或取消会消耗一次。图像调用至少间隔 61 秒。不代表文化含义、数据保留、权利或生产就绪已认证。")}</p>}
      {!direct&&room.generation?.expiresAt&&<p>{t("Authorization expires","授权到期")}: {new Date(room.generation.expiresAt).toLocaleString(language)}</p>}
      {!!room.generation?.cooldownUntil&&room.generation.cooldownUntil>Date.now()&&<p>{direct?t(`Please wait ${Math.ceil((room.generation.cooldownUntil-Date.now())/1000)} seconds before trying again.`,`请稍等 ${Math.ceil((room.generation.cooldownUntil-Date.now())/1000)} 秒再试。`):`${t("Next image request no earlier than","下次图像请求不早于")}: ${new Date(room.generation.cooldownUntil).toLocaleTimeString(language)}`}</p>}
      {(!simple||draft.output==="gif")&&<p>{direct?t("GIF adds gentle movement to a still image, not new character actions or a video.","GIF 为静图添加轻微动态，不会生成新的角色动作或视频。"):t("GIF means a generated still animated with local pan/zoom, not new actions or video. Existing Explain and Express remain separate.","GIF 是生成静图的本地平移缩放动画，不是生成动作或视频。现有解释与表达功能保持独立。")}</p>}</div>
    {!shared&&<label>{t("Creative intent","创作意图")}<textarea aria-label={t("Creative intent","创作意图")} maxLength={2000} value={draft.intent} onChange={e=>edit({intent:e.target.value})} placeholder={t("A warm welcome for a fictional puzzle team","为虚构的解谜小队送上温暖欢迎")} /></label>}
    {simple&&outputPicker}
    {room.contextualCreation&&<p className="local-muted">{t("One Azure planning request reads your reviewed chat, up to two owned frames, prior source explanations and voluntary preferences. Image generation receives text direction, not reference pixels. Web search runs only when enabled for three options.","一次 Azure 规划请求读取已审阅的聊天、最多两个已拥有的画面、已有来源解释与自愿偏好。图像生成仅接收文字方向，不接收参考像素。仅在三方案且开启搜索时运行网络搜索。")}</p>}
    <CreationOptions simple={simple} summary={<>{t("More options (optional)","更多选项（可选）")}{choiceSummary.length>0&&<span className="creation-option-summary">{choiceSummary.join(" · ")}</span>}</>}>
    {mixed&&creationInfo}
    {choices&&<><label>{t("Number of options","方案数量")}<select aria-label={t("Number of options","方案数量")} value={count} onChange={e=>{revoke();setBatchOptions({...batchOptions,count:e.target.value==="1"?1:3});}}>
      <option value="3">{mixed?t("3 options (existing image + 2 AI requests)","3 个方案（现成图 + 2 次 AI 图像请求）"):t("3 options (3 image requests)","3 个方案（3 次图像请求）")}</option><option value="1">{t("1 option (1 image request)","1 个方案（1 次图像请求）")}</option></select></label>
      {(!web||count===3)&&<label className="local-check"><input type="checkbox" checked={referenceMode==="popular-text"} onChange={e=>{revoke();setBatchOptions({...batchOptions,referenceMode:e.target.checked?"popular-text":"none"});}}/>
        {commons?t("Include Wikimedia image search","包含维基图片搜索"):web?t("Include web image search","包含全网图片搜索"):mixed&&count===3?t("Include an existing public image + caption","包含现成公开图片与配文"):t("Public meme inspiration (text only)","公开热图灵感（仅文字）")}</label>}</>}
    {web&&count===3&&<label>{t("Web search terms","网络搜索词")}<input maxLength={80} value={draft.searchTerms??(serp?"":deriveWebSearchTerms(draft.intent))} placeholder={serp?t("Automatic semantic keywords on Create","点击创建时自动规划语义搜索词"):undefined} onChange={e=>edit({searchTerms:e.target.value})}/></label>}
    {serp&&!room.contextualCreation&&count===3&&<><p className="local-muted">{t("Leave blank for non-identifying emotion/situation keywords. Explicit search terms are sent as entered; use only public words.","留空会生成不含身份信息的情绪与场景搜索词。手动搜索词将原样发送，请仅填写公开词语。")}</p>
      <label><input type="checkbox" checked={draft.allowPublicSearchReferences===true} onChange={e=>edit({allowPublicSearchReferences:e.target.checked})}/>{t("Allow public film/game/fictional-character names from my description in automatic search","允许自动搜索使用描述中的公开电影、游戏或虚构角色名称")}</label></>}
    {room.contextualCreation&&<label>{t("Visual context (optional override)","图片上下文（可选指定）")}<select aria-label={t("Visual context (optional override)","图片上下文（可选指定）")} value={draft.visualContextId??""} onChange={e=>edit({visualContextId:e.target.value||undefined})}>
      <option value="">{t("Automatic: relevant recent incoming visuals","自动：最近相关的来图")}</option>
      {room.messages.filter(m=>(m.attachment||m.visual||m.generated)&&draft.context.some(c=>c.included&&c.label===m.id)).map(m=><option key={m.id} value={m.id}>{m.speaker}: {m.text.slice(0,70)||t("Image","图片")}</option>)}
    </select></label>}
    {room.contextualCreation&&<><label>{t("Contextual callback","接梗方式")}<select aria-label={t("Contextual callback","接梗方式")} value={draft.expression?.culturalMode??"follow-conversation"} onChange={e=>edit({expression:{...draft.expression!,reference:e.target.value==="explicit"?draft.expression?.reference??"":"",culturalMode:e.target.value as ExpressionOptions["culturalMode"]}})}>
      <option value="follow-conversation">{t("Follow context when fitting","合适时接梗")}</option>
      <option value="original">{t("Plain / original reply","普通／原创回复")}</option>
      <option value="explicit">{t("Use my reference override","使用我指定的参考")}</option>
    </select></label>
    {draft.expression?.culturalMode==="explicit"&&<label>{t("Reference override","指定参考")}<input aria-label={t("Reference override","指定参考")} maxLength={400} value={draft.expression.reference} onChange={e=>edit({expression:{...draft.expression!,reference:e.target.value}})}/></label>}</>}
    <label>{simple?t("Additional details (optional)","补充细节（可选）"):t("Creative description","创作描述")}<textarea aria-label={t("Creative description","创作描述")} maxLength={2000} value={draft.creative} onChange={e=>edit({creative:e.target.value})} placeholder={t("Who or what, expression, gesture, a simple situation; optional","主体、表情、动作与简洁场景，可选")} /></label>
    <label>{t("Expression style","表达风格")}<select aria-label={t("Expression style","表达风格")} value={draft.expression?.style} onChange={e=>edit({expression:{...draft.expression!,style:e.target.value as ExpressionOptions["style"]}})}>
      {expressionStyles.map(s=><option key={s.id} value={s.id}>{room.contextualCreation&&s.id==="auto"?t("Match reply context","匹配回复上下文"):language==="en"?s.en:s.zh}</option>)}</select></label>
    {room.contextualCreation&&<p className="reply-style-policy">{draft.expression?.style==="auto"
      ?t("Keep the reply's visual style; vary expression and framing, not the medium.","保持回复对象的视觉风格；变化表情与构图，不默认更换媒介。")
      :t("Explicit style selected; it may intentionally change the reply's appearance.","已明确选择风格，可能有意改变回复的视觉表现。")}</p>}
    <label>{t("Expression intensity","表达强度")}<select aria-label={t("Expression intensity","表达强度")} value={draft.expression?.intensity} onChange={e=>edit({expression:{...draft.expression!,intensity:e.target.value as ExpressionOptions["intensity"]}})}>
      <option value="auto">{t("Follow description","跟随描述")}</option>
      <option value="restrained">{t("Restrained","克制")}</option><option value="balanced">{t("Balanced","适中")}</option><option value="exaggerated">{t("Exaggerated","夸张")}</option></select></label>
    <p className="local-muted">{t("Your main description takes priority over conflicting optional settings. Character references guide an original interpretation, not copied film frames, posters or logos; no license is implied.","主描述优先于有冲突的可选设置。角色参考用于原创演绎，不复制电影截图、海报或标志，也不代表取得授权。")}</p>
    {!simple&&outputPicker}
    <details className="studio-preferences"><summary>{t("Culture & style (optional)","文化与风格（可选）")}</summary>
    <p>{t("Additional requester / intended-audience preferences, separate from the speaker report above. Leave unknowns blank.","额外的请求者／目标受众偏好，与上方发言者报告分开。未知项留空。")}</p>
    {!room.contextualCreation&&<label>{t("Textual reference idea","文字参考灵感")}<input maxLength={400} value={draft.expression?.reference??""} onChange={e=>edit({expression:{...draft.expression!,reference:e.target.value}})} placeholder={t("e.g. the quietly relieved reaction, in an original scene","例如：终于松了一口气的反应，用原创场景表达")}/></label>}
    {(["culture","familiarity","tone","relationship","humor","avoid"] as const).map((key,i)=>shared&&key!=="culture"?null:<label key={key}>{t(["Culture / language context","Familiarity","Tone","Relationship","Humor","Avoid"][i],["文化 / 语言背景","熟悉程度","语气","关系","幽默","避免内容"][i])}
      <input maxLength={300} value={draft.preferences[key]} onChange={e=>edit({preferences:{...draft.preferences,[key]:e.target.value}})} /></label>)}
    </details>
    {!shared&&<><h4>{t("Optional reviewed text context","可选的已审阅文字上下文")}</h4>
    <button className="local-secondary" disabled={busy} onClick={()=>edit({context:contexts()})}>{t("Reload current message text","重新载入当前消息文字")}</button>
    {draft.context.map((c,i)=><div className="local-context-row" key={c.label}>
      <input type="checkbox" aria-label={`${t("Use creative context","使用创作上下文")} ${i+1}`} checked={c.included} onChange={e=>edit({context:draft.context.map(x=>x.label===c.label?{...x,included:e.target.checked}:x)})} />
      <textarea maxLength={2000} aria-label={`${t("Creative context","创作上下文")} ${i+1}`} value={c.text} onChange={e=>edit({context:draft.context.map(x=>x.label===c.label?{...x,text:e.target.value}:x)})} />
      <button aria-label={`${t("Remove creative context","移除创作上下文")} ${i+1}`} onClick={()=>edit({context:draft.context.filter(x=>x.label!==c.label)})}>×</button>
    </div>)}</>}
    {shared?.advanced}
    {simple&&<><button type="button" disabled={busy||shared?.blocked} onClick={()=>{edit({...emptyCreativeDraft(language),output:draft.output});shared?.onReset();}}>{t("Reset optional choices","重置可选设置")}</button>
      <p className="local-muted">{t("Keeps your description and output; saved speaker profiles are not deleted.","保留主描述和输出类型，不删除已保存的发言者偏好。")}</p></>}
    </CreationOptions>
    {direct?<><button className="local-primary" disabled={busy||shared?.blocked||unresolved||!draft.intent.trim()||draft.expression?.culturalMode==="explicit"&&!draft.expression.reference.trim()||!room.revision||!room.generation?.ready} onClick={()=>void createDirect()}>
      {mixed?t(`Create ${count===3&&referenceMode==="none"?2:count} option${count===1?"":"s"}`,`创建 ${count===3&&referenceMode==="none"?2:count} 个方案`):choices?t(`Generate ${count} ${draft.output==="gif"?"GIF ":""}option${count===1?"":"s"}`,`生成 ${count} 个${draft.output==="gif"?" GIF":""}方案`):draft.output==="gif"?t("Generate GIF","生成 GIF"):t("Generate image","生成图片")}</button>
      {(busy||unresolved)&&<button className="local-secondary" onClick={revoke}>{t("Cancel generation","取消生成")}</button>}
      <p className="local-muted">{mixed?t("Inspect and insert manually; nothing is posted automatically.","检查后手动插入，不会自动发送。"):t("Your click uses the current text and options. Inspect the result before inserting it; nothing is posted automatically.","点击即使用当前文字和选项开始生成。请检查结果后再手动插入，不会自动发送。")}</p></>:
      <button className="local-primary" disabled={busy||!draft.intent.trim()||!room.revision} onClick={()=>void prepare()}>{t("Prepare exact creative brief","准备确切创作简报")}</button>}
    {error&&<div role="alert" className="local-error">{direct?friendlyLocalError(error,language):`${t("Operation blocked; nothing inserted. Check the status before a new attempt.","操作已阻止，没有插入内容。再次尝试前请查看状态。")} ${error}`}
      {error==="generation-context-planning"&&planningReason&&<p>{t("Planner diagnostic","规划诊断")}: {planningReason}
        {planningIssues?.map(issue=><span key={issue.field}>{` · ${issue.field}: ${issue.actualType} / ${issue.rule}${issue.actualLength!==undefined?` (${issue.actualLength} > ${issue.limit})`:""}`}</span>)}</p>}</div>}
    {mixed?<p className="creation-summary">{count===3&&referenceMode==="popular-text"?t("1 existing image with editable caption + 2 AI-generated options.","1 张现成图（配文可改）+ 2 个 AI 生成方案。"):t(`${imageRequestCount} AI-generated option${imageRequestCount===1?"":"s"}.`,`${imageRequestCount} 个 AI 生成方案。`)}
      {room.semanticCreation&&count===3&&referenceMode==="popular-text"&&t(" Includes one AI-assisted image search."," 含 1 次 AI 辅助选图。")}</p>:creationInfo}
    {serp&&count===3&&referenceMode==="popular-text"&&<p className="local-muted">{t("Google Images via SerpApi · search keywords may be sent externally.","通过 SerpApi 搜索 Google 图片 · 搜索词可能发送至外部服务。")}{batch?.existing?.searchTerms&&<> {t("Search terms used","已使用搜索词")}: {batch.existing.searchTerms}</>}</p>}
    {web&&!serp&&count===3&&referenceMode==="popular-text"&&<p className="local-muted">{commons?t("Wikimedia search terms (shared library; no key; edit in More options)","维基搜索词（共享素材库，无需密钥，可在更多选项修改）"):t("Brave search terms (when configured; edit in More options)","Brave 搜索词（配置后发送，可在更多选项中修改）")}: {draft.searchTerms??deriveWebSearchTerms(draft.intent)}{commons&&t(" Only these terms are sent to Wikimedia."," 仅向维基发送这些搜索词。")}</p>}
    {serp&&(!room.webCreation?.configured||batch?.existing?.status==="failed"&&batch.existing.code==="web-image-search-auth")&&<details className="web-search-setup"><summary>{t("Configure Google Images via SerpApi","配置 SerpApi Google 图片搜索")}</summary><p>{t("Register your own SerpApi account, then run npm run serpapi:setup locally. Enter the key only in the hidden terminal prompt, never in chat. Start a fresh Google-images instance afterward. No account or paid plan is created automatically.","请自行注册 SerpApi 账户，然后在本地运行 npm run serpapi:setup。只在终端隐藏提示中输入密钥，不要发到聊天。之后启动新的 Google 图片实例；不会自动创建账户或付费计划。")}</p></details>}
    {web&&!commons&&!serp&&(!room.webCreation?.configured||batch?.existing?.status==="failed"&&batch.existing.code==="web-image-search-auth")&&<details className="web-search-setup"><summary>{t("Configure web image search","配置全网图片搜索")}</summary>
      <p>{t("A Brave Search-plan API key is required. Run npm run web-search:setup in your local terminal; enter the key only in its protected prompt, never in chat. Start a fresh server afterward. Existing rooms are not restarted automatically.","需要 Brave Search 计划的 API key。在本地终端运行 npm run web-search:setup，仅在受保护提示中输入密钥，不要发到聊天。之后启动新服务器，现有房间不会自动重启。")}</p></details>}
    {choices&&["meme-source-unavailable","meme-source-invalid"].includes(error)&&<button disabled={busy} onClick={()=>{setBatchOptions({...batchOptions,referenceMode:"none"});void createDirect("none");}}>
      {t("Generate without online inspiration","不使用网络灵感生成")}</button>}
    {busy&&<p role="status">{mixed?t("Creating options…","正在准备方案…"):direct?t("Generating…","生成中…"):t("Preparing / processing…","正在准备或处理…")}</p>}
    {batch&&<section className="generation-batch" aria-label={mixed?t("Creation options","创作方案"):t("Generated options","生成方案")}>
      <p role="status">{t(`${cards.filter(c=>c.kind==="existing"?c.status==="ready":c.operation.status==="ready").length} of ${cards.length} ready`,`${cards.length} 个方案中已有 ${cards.filter(c=>c.kind==="existing"?c.status==="ready":c.operation.status==="ready").length} 个就绪`)}</p>
      {batch.inspiration&&<InspirationDetails value={batch.inspiration} language={language}/>}
      {batch.contextPlan&&<p className="context-match-cue">{t("Matching the conversation: ","匹配对话：")}{batch.contextPlan.hook??batch.contextPlan.franchise??batch.contextPlan.characters[0]??batch.contextPlan.motif}
        {batch.contextPlan.referenceChoice!=="original"&&batch.contextPlan.certainty!=="grounded"&&t(" (source uncertain)","（来源不确定）")}{batch.contextPlan.mode==="override"&&t(" · your explicit choice takes priority"," · 优先采用明确选择")}</p>}
      {batch.contextPlan&&<p className="context-style-cue">{selectedStyle&&selectedStyle.id!=="auto"?t("Output style: ","输出风格："):t("Reply visual style: ","回复对象风格：")}{selectedStyle&&selectedStyle.id!=="auto"
        ?`${language==="en"?selectedStyle?.en:selectedStyle?.zh} · ${t("explicit choice","明确选择")}`
        :replyVisualStyles.find(style=>style.id===batch.contextPlan!.visualStyle)?.[language==="en"?"en":"zh"]}</p>}
      {batch.contextPlan&&<section className="context-reference-summary" aria-label={t("Contextual reply plan","上下文回复方案")}>
        <h4>{t("Contextual reply plan","上下文回复方案")}</h4>
        <p><b>{t("Context hook","上下文线索")}: </b>{batch.contextPlan.hook??batch.contextPlan.franchise??t("None — ordinary context-fitting reply","无 — 合适的普通回复")}
          {batch.contextPlan.referenceChoice!=="original"&&batch.contextPlan.certainty!=="grounded"&&t(" · source uncertain"," · 来源不确定")}</p>
        <p><b>{t("Current reply","当前回复")}: </b>{batch.contextPlan.replyIntent}</p>
        <p><b>{t("Reference choice","参考选择")}: </b>{t(
          {"same-source":"Continue a grounded hook","related":"Related grounded reference","original":"Ordinary original reply","explicit":"Explicit override"}[batch.contextPlan.referenceChoice],
          {"same-source":"延续有依据的线索","related":"有依据的相关参考","original":"普通原创回复","explicit":"明确指定"}[batch.contextPlan.referenceChoice])}
          {batch.contextPlan.characters.length>0&&` · ${batch.contextPlan.characters.join(" / ")}`} · {batch.contextPlan.reason}</p>
        {batch.contextPlan.adaptedCaption&&<p><b>{t("New adapted caption — not a source quote","新改编配文 — 并非来源原句")}: </b>{batch.contextPlan.adaptedCaption}</p>}
        <p className="local-muted">{t("Original AI-created reply, not an original source image. A callback does not establish shared history or audience familiarity.","AI 原创回复，并非来源原图。接梗不代表存在共同经历，也不代表受众熟悉。")}</p>
      </section>}
      <div className="generation-candidates">{cards.map((candidate,index)=>{
        if(candidate.kind==="existing")return <article className="generation-candidate existing-candidate" key={candidate.id}>
          <h4>{serp?t("Google image + caption","Google 图片配文"):commons?t("Wikimedia image + caption","维基图片配文"):t("Existing image + caption","现成图配文")}</h4>
          {candidate.status==="ready"?<>
            <PublicArtwork visual={candidate.visual} language={language}/><p>{candidate.caption}</p>
            <PublicNotices visual={candidate.visual} language={language}/>
            <button aria-pressed={selectedExisting?.id===candidate.id} onClick={()=>{clearPreview();setSelectedExisting(candidate);setOperation(undefined);setCaption(candidate.caption);}}>
              {candidate.visual.webSource?t("Use web preview + caption","使用网络预览图与配文"):t("Use original image + caption","使用原图与配文")}</button>
          </>:<p role="alert">{candidate.code.startsWith("model-output")?t("Image search returned an invalid selection. AI options continue.","图片搜索返回了无效选择，AI 方案继续。"):friendlyLocalError(candidate.code,language)}</p>}
        </article>;
        const value=candidate.operation,style=expressionStyles.find(style=>style.id===candidate.treatment);
        const specified=selectedStyle?.id!=="auto"?selectedStyle:undefined;
        const treatment=room.contextualCreation?t(candidate.treatment==="cinematic-photo"?"Alternative framing":"Close reaction",candidate.treatment==="cinematic-photo"?"另一构图":"近景反应")
          :candidate.treatment==="natural-photo"?t("Natural light","自然光"):candidate.treatment==="cinematic-photo"?t("Cinematic lighting","电影布光"):candidate.treatment==="reaction-sticker"?t("Clean composition","简洁构图"):candidate.treatment==="light-comic"?t("Expressive gesture","生动动作"):t("Loose accents","轻松笔触");
        const requestedArt=/\b(cartoon|anime|illustration|watercolou?r|doodle|comic|pixel art)\b|卡通|漫画|插画|水彩|动漫/iu.test(`${draft.intent} ${draft.creative}`);
        const label=room.contextualCreation&&!specified?(candidate.treatment==="natural-photo"?t("Context-matched reaction","上下文反应图"):t("Alternative framing","同主题另一构图")):specified?`${language==="en"?specified.en:specified.zh}${candidate.treatment==="requested"?"":` · ${treatment}`}`:mixed&&requestedArt?`${t("Description-led variation","跟随描述的变化")} · ${treatment}`:style?(language==="en"?style.en:style.zh):t("Your description","你的描述");
        const visual=value.animation??value.image;
        return <article className="generation-candidate" key={candidate.id} aria-label={`${t("Option","方案")} ${index+1}: ${label}`}>
          <h4>{index+1}. {mixed?"AI ":""}{label}</h4><p role="status">{value.status==="reviewed"?t("Not started","尚未开始"):statusText[value.status]}</p>
          {mixed&&<p>{t("AI-generated, not a photograph of a real event.","AI 生成，不是真实事件照片。")}</p>}
          {value.code&&<p role="alert">{friendlyLocalError(value.code,language)}</p>}
          {visual&&<><GeneratedArtwork visual={visual} language={language} showDetails={false}/>
            <button aria-pressed={operation?.image?.assetId===value.image?.assetId} onClick={()=>{
              clearPreview();setSelectedExisting(undefined);setOperation(value);setAlt(visual.alt);setVariant(value.animation?"animation":"image");setChecked(false);
              if(operation?.operationId!==value.operationId)setCaption(batch.contextPlan?.adaptedCaption??"");
            }}>{t("Choose this option","选择此方案")}</button></>}
        </article>;
      })}</div>
      {mixed&&batch.existing&&batch.existing.status!=="skipped"&&!batch.inspiration&&<p role="status">      {batch.contextPlan?t("Both AI options share the same visual-context direction. Retrieved titles cannot replace that direction; no reference pixels condition generation.","两个 AI 方案使用同一图片上下文方向，检索标题不会替换该方向；生成不接收参考像素。"):web?t("AI options use your description without web image references.","AI 方案使用你的描述，不含网络图片参考。"):t("AI options use your description without meme inspiration.","AI 方案继续使用你的描述，不含热图参考。")}</p>}
      {batch.existing?.status==="failed"&&<button disabled={busy||shared?.blocked} title={t("Retries only image search, never AI image generation.","仅重试选图，不重新生成 AI 图片。")} onClick={()=>void work(async(signal,id)=>{
        const value=await localRequest<LocalGenerationBatch>("generation/batch/source/retry",{revision:roomRef.current.revision,batchId:batch.batchId,digest:batch.digest},signal);
        if(fresh(id))setBatch(value);
      })}>{t("Retry image search","重试图片搜索")}</button>}
      {["paused","reviewed"].includes(batch.status)&&batch.candidates.some(c=>["failed","reviewed","expired"].includes(c.operation.status))&&
        <button disabled={busy||shared?.blocked||!room.generation?.ready} onClick={()=>void retryBatch(batch.existing?.status==="failed")}>
          {mixed?t("Retry unfinished AI options","重试未完成的 AI 方案"):t("Retry failed / not-started options only","仅重试失败或尚未开始的方案")}</button>}
      {batch.status==="running"&&!busy&&<button onClick={()=>void work(async(signal,id)=>{
        const value=await localRequest<LocalGenerationBatch>("generation/batch/status",{batchId:batch.batchId},signal);
        if(fresh(id))await observeBatch(value,signal,id);
      })}>{t("Check batch status (no new requests)","查询方案状态（不发起新生成）")}</button>}
      {batch.status==="paused"&&<p>{t("Completed options are kept. No automatic retry; a retry click authorizes only failed or not-started options. Uncertain completions are never resubmitted.","已完成的方案会保留，不会自动重试。点击重试只授权失败或尚未开始的方案，不会再次提交完成情况不明的请求。")}</p>}
    </section>}
    {selectedExisting&&batch&&<section className="existing-selection" aria-label={t("Existing-image selection","现成图选择")}>
      <h4>{selectedExisting.visual.webSource?t("Use web preview + caption","使用网络预览图与配文"):t("Use original image + caption","使用原图与配文")}</h4>
      <p>{selectedExisting.captionOrigin==="manual-required"?t("Your description exceeds 500 characters. Write a shorter caption; it was not truncated.","描述超过 500 字符，请另写较短配文；没有截断原描述。"):
        t("The draft caption is your description verbatim, not AI-written. Edit it for this image.","初始配文直接使用你的描述，不是 AI 撰写；请按图片修改。")}</p>
      <label>{t("Caption beside image","图片旁的配文")}<textarea aria-label={t("Caption beside image","图片旁的配文")} maxLength={localOutputCaptionLimit} value={caption} onChange={e=>{setCaption(e.target.value);clearPreview();}}/></label>
      <button disabled={busy||!caption.trim()} onClick={()=>void work(async(signal,id)=>{
        const ticket=insertionEpoch.current;await cancelQueue.current;if(!fresh(id)||ticket!==insertionEpoch.current)return;
        const pending=localRequest<LocalInsertPreview>("generation/batch/source/preview",{revision:roomRef.current.revision,batchId:batch.batchId,digest:batch.digest,caption,speaker},signal);
        pendingExistingPreview.current=pending;
        try{const value=await pending;if(fresh(id)&&ticket===insertionEpoch.current)setExistingPreview(value);}
        finally{if(pendingExistingPreview.current===pending)pendingExistingPreview.current=undefined;}
      })}>{selectedExisting.visual.webSource?t("Preview web image + caption","预览网络图片与配文"):t("Preview original image + caption","预览原图与配文")}</button>
    </section>}
    {existingPreview&&<section className="local-insert-preview" aria-label={t("Existing-image insertion preview","现成图插入预览")}>
      <strong>{existingPreview.speaker}</strong><p>{existingPreview.caption}</p>      <PublicArtwork visual={existingPreview.visual} language={language}/>
      <PublicNotices visual={existingPreview.visual} language={language}/>
      <p>{t("The caption stays beside the source image; no AI redraw or text overlay.","配文显示在来源图片旁，不经 AI 重绘，也没有文字叠加。")}</p>
      <button disabled={busy} onClick={()=>void work(async(signal,id)=>{
        const value=await localRequest<LocalState>("generation/batch/source/insert",{revision:roomRef.current.revision,handle:existingPreview.handle},signal);
        if(fresh(id)){adopt(value);clear();setCaption("");}
      })}>{existingPreview.visual.webSource?t("Insert web preview + caption locally","将网络预览图与配文插入本地"):t("Insert original image + caption locally","将原图与配文插入本地")}</button>
      <button onClick={clearPreview}>{t("Cancel insertion preview","取消插入预览")}</button>
    </section>}
    {!direct&&review&&<section className="generation-review" aria-label={t("Exact creative request","确切创作请求")}>
      <h4>{t("Every transmitted word and option","将发送的全部文字与选项")}</h4>
      <p>{t("Destination (server-bound, not editable)","目的地（由服务端绑定，不可编辑）")}: {review.destination?Object.values(review.destination).join(" · "):t("No provisioned image destination","尚无已部署的图像目的地")}</p>
      <pre>{review.body}</pre><p>{review.bodyBytes} bytes · {t("review valid at most 5 minutes","审阅最多有效 5 分钟")} · {review.profileVersion}</p>
      <p>{t("Text only. One 1024×1024 PNG at the low quality setting, then a 512px chat rendition. No automatic retries; small details may be lost.","只发送文字。单次请求一张 1024×1024 PNG，使用 low 质量设置，再生成 512 像素聊天版本。不会自动重试，细节可能损失。")}</p>
      {!direct&&<label className="local-check"><input type="checkbox" checked={consent} disabled={!review.dispatchable} onChange={e=>setConsent(e.target.checked)} />
        {t("I may use this non-sensitive test content and explicitly consent to this exact paid image request and disclosed limitations.","我有权使用这些非敏感测试内容，并明确同意本次确切的付费图像请求及已披露限制。")}</label>}
      {review.expiresAt<=Date.now()&&<p role="status">{t("Review expired; prepare it again.","审阅已过期，请重新准备。")}</p>}
      <button className="local-primary" disabled={!review.dispatchable||!room.generation?.ready||(!direct&&!consent)||busy||!!operation||review.expiresAt<=Date.now()} onClick={()=>void generate()}>{direct?t("Generate image","生成图片"):review.dispatchable?t("Generate once","生成一次"):t("Generate — not provisioned / authorized","生成 — 尚未部署 / 授权")}</button>
      <button className="local-secondary" onClick={revoke}>{t("Revoke this review","撤销本次审阅")}</button>
    </section>}
    {operation&&<section aria-label={t("Generation operation","生成操作")}><p role="status">{statusText[operation.status]}</p>
      {operation.animationFailed&&<p className="local-error">{t("GIF creation failed; the valid PNG is retained. No GIF success is claimed.","GIF 制作失败，保留有效 PNG，不会显示虚假的 GIF 成功结果。")}</p>}
      {operation.code&&<p role="alert">{direct?friendlyLocalError(operation.code,language):operation.code}</p>}
      {["dispatching","rendering","unknown-after-dispatch"].includes(operation.status)&&<button disabled={busy} onClick={()=>void work(async(signal,id)=>{
        const value=await localRequest<LocalGenerationStatus>("generation/status",{operationId:operation.operationId},signal);
        if(fresh(id)){setOperation(value);if(value.image)setAlt(value.image.alt);}
      })}>{t("Check known operation status","查询本次操作状态")}</button>}
      {operation.image&&<><div className="generation-variants"><button aria-pressed={variant==="image"} onClick={()=>{setVariant("image");setChecked(false);clearPreview();}}>{t("Use PNG","使用 PNG")}</button>
        {operation.animation&&<button aria-pressed={variant==="animation"} onClick={()=>{setVariant("animation");setChecked(false);clearPreview();}}>{t("Use local GIF","使用本地 GIF")}</button>}
        {!operation.animation&&<button disabled={busy} onClick={()=>void work(async(signal,id)=>{
          setPreview(undefined);insertionEpoch.current++;const value=await localRequest<{image:LocalGeneratedVisual;animation:LocalGeneratedVisual}>("generation/animate",{revision:roomRef.current.revision,assetId:operation.image!.assetId},signal);
          if(fresh(id)){setOperation({...operation,...value,animationFailed:false,code:undefined});setVariant("animation");setChecked(false);
            setBatch(batch=>batch?{...batch,candidates:batch.candidates.map(c=>c.operation.image?.assetId===value.image.assetId?{...c,operation:{...c.operation,...value,animationFailed:false,code:undefined}}:c)}:batch);}
        })}>{direct?t("Make an animated GIF","制作 GIF 动图"):t("Animate locally — zero image calls","制作本地动画 — 零图像调用")}</button>}</div>
        {active&&<><GeneratedArtwork visual={active} language={language} showDetails={!direct}/>{direct&&<p>{t("Check the image before sharing. Use only where you have permission.","分享前请检查图片，仅在有使用许可的场景使用。")}</p>}</>}
        <label>{t("Local output caption","本地输出配文")}<textarea aria-label={t("Local output caption","本地输出配文")} maxLength={localOutputCaptionLimit} value={caption} onChange={e=>{setCaption(e.target.value);clearPreview();}}/></label>
        <label>{t("Image description / alt text","图片描述 / 替代文字")}<textarea aria-label={t("Image description / alt text","图片描述 / 替代文字")} maxLength={300} value={alt} onChange={e=>{setAlt(e.target.value);clearPreview();}}/></label>
        {!direct&&<label className="local-check"><input type="checkbox" checked={checked} onChange={e=>{setChecked(e.target.checked);clearPreview();}}/>{t("I inspected this output, its meaning and notices for permitted local test use.","我已检查输出、含义和说明，确认可用于本地测试。")}</label>}
        <button className="local-primary" disabled={!active||(!direct&&!checked)||!alt.trim()||!speaker.trim()||busy} onClick={()=>void work(async(signal,id)=>{
          const ticket=insertionEpoch.current;await cancelQueue.current;if(!fresh(id)||ticket!==insertionEpoch.current)return;
          const pending=localRequest<LocalGeneratedInsertPreview>("generation/preview",{revision:roomRef.current.revision,assetId:active!.assetId,variant,caption,alt,speaker},signal);pendingPreview.current=pending;
          try{const value=await pending;if(fresh(id)&&ticket===insertionEpoch.current)setPreview(value);}
          finally{if(pendingPreview.current===pending)pendingPreview.current=undefined;}
        })}>{t("Preview generated insertion","预览生成内容插入")}</button>
      </>}
    </section>}
    {preview&&<section className="local-insert-preview" aria-label={t("Generated insertion preview","生成内容插入预览")}>
      <h4>{direct?t("Ready to add to the conversation","准备加入对话"):t("Exact local bubble — no prompt or private preferences","确切本地气泡，不含提示词或私有偏好")}</h4><strong>{preview.speaker}</strong><p>{preview.caption}</p>
      <GeneratedArtwork visual={preview.generated} language={language} showDetails={!direct}/>
      {direct&&<p>{t("Check the image and caption. Sharing still requires permission.","请检查图片与配文，分享仍需相应使用许可。")}</p>}
      <button className="local-primary" disabled={busy||(!direct&&!checked)} onClick={()=>void work(async(signal,id)=>{
        const value=await localRequest<LocalState>("generation/insert",{revision:roomRef.current.revision,handle:preview.handle},signal);
        if(fresh(id)){adopt(value);clear();setCaption("");setAlt("");}
      })}>{t("Insert generated visual locally","将生成内容插入本地")}</button>
      <button onClick={clearPreview}>{t("Cancel insertion preview","取消插入预览")}</button>
    </section>}
    {(review||operation||batch||busy)&&<button className="local-text-button" onClick={revoke}>{t("Cancel / discard uninserted output","取消 / 丢弃未插入输出")}</button>}
  </section>;
}
