import { Fragment,useEffect, useRef, useState } from "react";
import type { AnalysisResult, ContextSnippet, Language, ReviewInput } from "../shared/types";
import type { GenerationBatchOptions, LocalCatalogReview, LocalInsertPreview, LocalMessage, LocalReview, LocalState } from "../shared/local-chat";
import {canExplainLocalMessage} from "../shared/local-chat";
import { localRequest as sendLocalRequest,explainLocalMessage,LocalRequestError } from "./local-chat-api";
import { ExplanationPanel } from "./ExplanationPanel";
import {EmojiInspector} from "./EmojiInspector";
import {CustomEmojiArtwork} from "./CustomEmojiArtwork";
import {MessageVisual} from "./MessageVisual";
import type {InlineEmojiAnalysis,InlineExplanationState} from "./InlineEmojiExplanation";
import { GeneratedMediaDetails, LocalGenerationPanel } from "./LocalGenerationPanel";
import { ChatIcon,MessageActions,containFocus } from "./LocalChatChrome";
import {SpeakerProfileEditor} from "./SpeakerProfileEditor";
import type {SpeakerProfile} from "../shared/expression";
import {useComposerAttachment} from "./useComposerAttachment";
import {AnalysisConfirmation} from "./HumanConfirmation";
import {friendlyLocalError} from "./friendly-local-error";
import {UnifiedExpression,ExpressionPreferences,emptyExpression,emptyCreativeDraft,type ExpressionDraft} from "./UnifiedExpression";
import {LOCAL_CONTEXT_LIMIT,selectLocalContextMessages} from "../shared/local-context";
import {LocalEmojiExpression} from "./LocalEmojiExpression";
import {appendEmojiDraft} from "../shared/emoji-expression";
import {hasLocalVisual,selectedEmoji} from "../shared/local-chat";

import {PublicArtwork as Art,PublicNotices as Notice} from "./LocalPublicVisual";

export function LocalChatApp() {
  const [language, setLanguage] = useState<Language>("en");
  const t = (en: string, zh: string) => language === "en" ? en : zh;
  const [state, updateState] = useState<LocalState>({ revision: 0, messages: [], catalogAccepted: false, cooldownUntil: 0, providerRequests: 0 });
  const direct=state.interaction==="direct-personal";
  const canExplainMessage=(message:LocalMessage|undefined)=>!!message&&(!direct||canExplainLocalMessage(message));
  const internet=direct&&state.catalogSource==="internet";
  const setState=(value:LocalState|((previous:LocalState)=>LocalState))=>updateState(previous=>{
    const next=typeof value==="function"?value(previous):value;return next.revision>=previous.revision?next:previous;
  });
  const [catalog, setCatalog] = useState<LocalCatalogReview>();
  const [catalogOpen, setCatalogOpen] = useState(false), [attest, setAttest] = useState(false);
  const [speaker, setSpeaker] = useState("Alex"), [draft, setDraft] = useState("");
  const [selected, setSelected] = useState(""), [editing, setEditing] = useState("");
  const [command, setCommand] = useState<"explainVisual" | "recommendVisual">("explainVisual");
  const [creating,setCreating]=useState(false);
  const [expressionKind,setExpressionKind]=useState<"image"|"emoji">("image");
  const [emojiReply,setEmojiReply]=useState<string|null>(null);
  const composerState=useRef({draft,editing});composerState.current={draft,editing};
  const [expression,setExpression]=useState(emptyExpression);
  const [creativeOptions,setCreativeOptions]=useState(()=>emptyCreativeDraft(language));
  const [batchOptions,setBatchOptions]=useState<GenerationBatchOptions>({count:3,referenceMode:"popular-text"});
  const creationHasWork=useRef(false),sharedInvalidation=useRef<Promise<void>|undefined>(undefined);
  const unified=direct&&(creating||command==="recommendVisual");
  const emojiMode=unified&&state.emojiExpressions===true&&expressionKind==="emoji";
  const [intent, setIntent] = useState(""), [context, setContext] = useState<ContextSnippet[]>([]);
  const [formality, setFormality] = useState<"unknown" | "formal" | "casual">("unknown"), [avoid, setAvoid] = useState("");
  const [review, setReview] = useState<LocalReview>(), [consent, setConsent] = useState(false);
  const [result, setResult] = useState<AnalysisResult>(), [preview, setPreview] = useState<LocalInsertPreview>();
  const [explanationOwner,setExplanationOwner]=useState<{id:string;epoch:number;key:string;revision?:number;status:"pending"|"ready"|"error"|"cancelled";code?:string}>();
  const [caption, setCaption] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [bootstrap,setBootstrap]=useState<"pending"|"ready"|"failed"|"closed">("pending"),[bootstrapError,setBootstrapError]=useState("");
  const bootController=useRef<AbortController|undefined>(undefined),bootEpoch=useRef(0);
  const closingRoom=useRef(false);
  const initialized=bootstrap==="ready";
  const composer=useComposerAttachment(()=>!initialized||busy||!!editing||closingRoom.current);
  const attachment=composer.attachment;
  const [profileDirty,setProfileDirty]=useState(false);
  const quickFlight=useRef(false);
  const [quickMode,setQuickMode]=useState(false),[quickRunning,setQuickRunning]=useState(false),[savedProfileNotice,setSavedProfileNotice]=useState(false);
  const speakerQueue=useRef<Promise<unknown>>(Promise.resolve());
  const [search,setSearch]=useState(""),[chatsOpen,setChatsOpen]=useState(false);
  const [compact,setCompact]=useState(()=>typeof window!=="undefined"&&window.innerWidth<1100);
  const [panelOpen,setPanelOpen]=useState(()=>typeof window==="undefined"||window.innerWidth>=1100),[demoLoaded,setDemoLoaded]=useState(false);
  const assistantHeading=useRef<HTMLHeadingElement>(null),assistantReturn=useRef<HTMLElement|null>(null);
  const assistantPanel=useRef<HTMLElement>(null);
  const composerInput=useRef<HTMLTextAreaElement>(null),timeline=useRef<HTMLDivElement>(null),libraryDialog=useRef<HTMLDialogElement>(null);
  const emojiPicker=useRef<HTMLDetailsElement>(null),chatToggle=useRef<HTMLButtonElement>(null);
  const chatList=useRef<HTMLElement>(null);
  const previousCount=useRef(0);
  const abort = useRef<AbortController | undefined>(undefined), generation = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  const mounted=useRef(true),actionId=useRef(0);
  const [errorByteLimit,setErrorByteLimit]=useState<LocalRequestError["byteLimit"]>();
  const insertionEpoch=useRef(0),pendingInsertion=useRef<Promise<LocalInsertPreview>|undefined>(undefined),insertionQueue=useRef(Promise.resolve());
  async function localRequest<T>(path:string,body:object={},signal?:AbortSignal):Promise<T>{
    const epoch=generation.current;
    try {
      const value=await sendLocalRequest<T>(path,body,signal);
      if(!mounted.current||epoch!==generation.current)throw new DOMException("Stale local response","AbortError");
      return value;
    } catch(error){
      if(!mounted.current||epoch!==generation.current)throw new DOMException("Stale local response","AbortError");
      setErrorByteLimit(error instanceof LocalRequestError?error.byteLimit:undefined);throw error;
    }
  }
  const resetResults = () => { generation.current++; abort.current?.abort(); setReview(undefined); setConsent(false); setResult(undefined); setExplanationOwner(undefined); setPreview(undefined); };
  useEffect(()=>{
    const media=matchMedia("(max-width: 1099px)"),resize=()=>setCompact(media.matches);
    media.addEventListener("change",resize);return()=>media.removeEventListener("change",resize);
  },[]);
  useEffect(()=>{
    const dialog=libraryDialog.current;
    if(catalogOpen&&!dialog?.open)dialog?.showModal();else if(!catalogOpen&&dialog?.open)dialog.close();
  },[catalogOpen]);
  useEffect(()=>{
    if(compact&&chatsOpen)chatList.current?.querySelector<HTMLButtonElement>(".studio-mobile-only")?.focus();
  },[compact,chatsOpen]);
  function hideChats(){setChatsOpen(false);requestAnimationFrame(()=>chatToggle.current?.focus());}
  useEffect(()=>{
    if(state.messages.length>previousCount.current){
      if(timeline.current)timeline.current.scrollTop=timeline.current.scrollHeight;
      if(compact){setPanelOpen(false);requestAnimationFrame(()=>composerInput.current?.focus());}
    }
    previousCount.current=state.messages.length;
  },[state.messages.length,compact]);
  useEffect(()=>{if(demoLoaded&&timeline.current)timeline.current.scrollTop=0;},[demoLoaded]);
  function showAssistant(){
    if(!assistantPanel.current?.contains(document.activeElement))assistantReturn.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setPanelOpen(true);setChatsOpen(false);requestAnimationFrame(()=>assistantHeading.current?.focus());
  }
  function hideAssistant(){setPanelOpen(false);requestAnimationFrame(()=>{if(assistantReturn.current?.isConnected&&assistantReturn.current.getClientRects().length)assistantReturn.current.focus();else composerInput.current?.focus();});}
  useEffect(()=>{
    if(!panelOpen||catalogOpen)return;
    const key=(e:KeyboardEvent)=>{
      if(e.defaultPrevented)return;
      if(e.key==="Escape"){e.preventDefault();hideAssistant();}
      else if(compact&&e.key==="Tab"&&!assistantPanel.current?.contains(document.activeElement)){
        e.preventDefault();assistantHeading.current?.focus();
      }
    };
    document.addEventListener("keydown",key);return()=>document.removeEventListener("keydown",key);
  },[panelOpen,compact,catalogOpen]);
  function selectTool(tool:"explain"|"express"|"create",focus=true){
    if(!initialized)return;
    if(focus)showAssistant();setCreating(tool==="create");setQuickMode(false);
    if(direct){
      setCommand(tool==="explain"?"explainVisual":"recommendVisual");
      if(tool!=="explain"){
        if(state.emojiExpressions&&selected){setEmojiReply(selected);setExpression(value=>({...value,loaded:true,context:expressionContext(selected),version:value.version+1}));}
        const selectedVisual=state.contextualCreation?state.messages.find(m=>m.id===selected&&(m.attachment||m.visual||m.generated)):undefined;
        if(!expression.loaded&&selectedVisual)setCreativeOptions(value=>({...value,visualContextId:selectedVisual.id}));
        setExpression(value=>value.loaded?value:{...value,loaded:true,context:expressionContext(selectedVisual?.id)});
      }
    }else{
      if(tool!=="create")setCommand(tool==="express"?"recommendVisual":"explainVisual");
      if(tool==="express"&&!context.length)setContext(expressionContext());
    }
    creationHasWork.current=false;
    void invalidate();
  }
  function expressionContext(selectedId?:string){return selectLocalContextMessages(state.messages,selectedId).map(m=>({label:m.id,text:`${m.speaker}: ${m.text}`,timestamp:"",included:true}));}
  function editExpression(change:Partial<ExpressionDraft>){
    setExpression(value=>({...value,...change,version:value.version+1}));
    if(!sharedInvalidation.current&&(creationHasWork.current||review||result||preview||busy)){
      creationHasWork.current=false;
      const pending=invalidate();sharedInvalidation.current=pending;
      void pending.finally(()=>{if(sharedInvalidation.current===pending)sharedInvalidation.current=undefined;});
    }
  }
  function clearLocalForm(){
    setExpressionKind("image");setEmojiReply(null);
    setQuickMode(false);setSavedProfileNotice(false);
    setCreating(false);setPanelOpen(!compact);setChatsOpen(false);resetResults();setSelected("");setContext([]);setDraft("");composer.clear();setAttest(false);
    setIntent("");setAvoid("");setCaption("");setEditing("");setFormality("unknown");setSpeaker("Alex");setSearch("");setDemoLoaded(false);
    setCommand("explainVisual");if(fileInput.current)fileInput.current.value="";
    setExpression(emptyExpression());setCreativeOptions(emptyCreativeDraft(language));setBatchOptions({count:3,referenceMode:"popular-text"});creationHasWork.current=false;
  }
  function clearRoom(){if(!initialized)return;clearLocalForm();void action(async()=>setState(await localRequest<LocalState>("reset")));}
  async function closeRoom(){
    if(!initialized||closingRoom.current||!window.confirm(t("Close this room and erase its messages and profiles? Other rooms are unchanged.","关闭本房间并清除其中的消息与偏好？不会影响其他房间。")))return;
    closingRoom.current=true;
    composer.cancelRead();
    try{await action(async()=>{
      await localRequest("session/close");clearLocalForm();
      updateState({revision:0,messages:[],catalogAccepted:false,cooldownUntil:0,providerRequests:0});
      setCatalog(undefined);setCatalogOpen(false);setBootstrap("closed");
    });}finally{closingRoom.current=false;}
  }
  async function loadDemo(){
    if(busy||state.messages.length||!state.revision)return;
    resetResults();setSearch("");setChatsOpen(false);
    await action(async()=>{
      const controller=new AbortController();abort.current=controller;
      setState(await localRequest<LocalState>("demo",{revision:state.revision,language,...(state.emojiExpressions?{scenario:"combined"}:{})},controller.signal));
      setDemoLoaded(true);
    });
  }
  async function initialize(){
    if(bootController.current)return;
    const id=++bootEpoch.current,controller=new AbortController();bootController.current=controller;
    setBootstrap("pending");setBootstrapError("");
    try{
      const value=await sendLocalRequest<LocalState & {catalog:LocalCatalogReview}>("session",{},controller.signal);
      if(mounted.current&&id===bootEpoch.current){updateState(value);setCatalog(value.catalog);setSpeaker(value.outgoingSpeaker??"Alex");setBootstrap("ready");}
    }catch(e){
      if(mounted.current&&id===bootEpoch.current&&!controller.signal.aborted){
        setBootstrapError(e instanceof TypeError||e instanceof SyntaxError?"not-configured":e instanceof Error?e.message:"not-configured");setBootstrap("failed");
      }
    }finally{if(id===bootEpoch.current)bootController.current=undefined;}
  }
  useEffect(() => {
    mounted.current=true;void initialize();
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => { mounted.current=false;bootEpoch.current++;bootController.current?.abort();bootController.current=undefined;generation.current++;actionId.current++;clearInterval(tick); abort.current?.abort(); };
  }, []);
  async function refresh() { const epoch=generation.current;try { setState(await localRequest<LocalState>("state")); } catch { if(mounted.current&&epoch===generation.current)setError("auth-required"); } }
  async function action(work: () => Promise<void>) {
    if(!initialized)return;
    const id=++actionId.current,epoch=++generation.current;
    setBusy(true); setError("");
    try { await work(); } catch (e) { if(mounted.current&&id===actionId.current&&epoch===generation.current){if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "not-configured"); await refresh();} }
    finally { if(mounted.current&&id===actionId.current)setBusy(false); }
  }
  async function invalidate() {
    if(!initialized)return;
    resetResults();
    await action(async () => { setState(await localRequest<LocalState>("cancel")); });
  }
  function changeSpeaker(value:string){
    if(!initialized)return;
    setSpeaker(value);resetResults();clearInsertionPreview();
    const prior=speakerQueue.current;
    const pending=action(async()=>{
      const epoch=generation.current;await prior;if(epoch!==generation.current)return;
      setState(await localRequest<LocalState>(value.trim()?"speaker":"cancel",value.trim()?{speaker:value.trim()}:{}));
    });
    speakerQueue.current=pending;
  }
  const explainedMessage=!creating&&command==="explainVisual"?state.messages.find(m=>m.id===selected):undefined;
  const profileSpeaker=explainedMessage?.speaker??speaker;
  function profileEditing(dirty:boolean){setProfileDirty(dirty);if(dirty)void invalidate();}
  async function saveProfile(profile:SpeakerProfile|null){
    resetResults();await action(async()=>{
      const latest=await localRequest<LocalState>("state");
      setState(await localRequest<LocalState>("speaker/profile",{revision:latest.revision,speaker:profileSpeaker,profile}));setProfileDirty(false);
    });
  }
  function clearInsertionPreview() {
    const pending=pendingInsertion.current,ticket=++insertionEpoch.current,epoch=generation.current;setPreview(undefined);
    if(!preview&&!pending)return;
    insertionQueue.current=Promise.allSettled([insertionQueue.current,...(pending?[pending]:[])]).then(async()=>{
      try{await sendLocalRequest("preview/cancel");}
      catch(error){if(mounted.current&&epoch===generation.current&&ticket===insertionEpoch.current)setError(error instanceof Error?error.message:"not-configured");}
    });
  }
  async function trackExplanation(id:string,key:string,work:()=>Promise<{result:AnalysisResult;state:LocalState}>){
    const epoch=generation.current;
    setExplanationOwner({id,key,epoch,status:"pending"});
    try{
      const value=await work();
      if(!mounted.current||epoch!==generation.current)return;
      if(value.result.status!=="ready")throw new Error(value.result.code);
      if(value.result.kind!=="explanation")throw new Error("model-output-invalid");
      setResult(value.result);setState(value.state);
      setExplanationOwner({id,key,epoch,revision:value.state.revision,status:"ready"});
    }catch(error){
      if(mounted.current&&epoch===generation.current&&!(error instanceof DOMException&&error.name==="AbortError"))
        setExplanationOwner({id,key,epoch,status:"error",code:error instanceof Error?error.message:"not-configured"});
      throw error;
    }
  }
  function inlineAnalysis(message:LocalMessage):InlineEmojiAnalysis|undefined{
    if(!direct||!canExplainMessage(message))return undefined;
    const owner=explanationOwner?.id===message.id&&selected===message.id&&explanationOwner.epoch===generation.current
      &&!creating&&command==="explainVisual"?explanationOwner:undefined;
    let inlineState:InlineExplanationState={status:"idle"};
    if(owner?.status==="pending")inlineState={status:"pending"};
    else if(owner?.status==="error")inlineState={status:"error",message:friendlyLocalError(owner.code??"not-configured",language)};
    else if(owner?.status==="cancelled")inlineState={status:"cancelled"};
    else if(owner?.status==="ready"&&owner.revision===state.revision&&result?.status==="ready"&&result.kind==="explanation")
      inlineState={status:"ready",explanation:result.explanation};
    return {state:inlineState,disabled:!initialized||busy||quickRunning||cooldown>0,
      kind:hasLocalVisual(message)&&message.demoMedia!=="custom-emoji"?"visual":"emoji",showBackground:hasLocalVisual(message),
      onExplain:()=>choose(message,true),onCancel:()=>void cancelExplanation(message.id)};
  }
  async function cancelExplanation(id:string){
    if(explanationOwner?.id!==id||explanationOwner.status!=="pending")return;
    resetResults();
    await action(async()=>{
      const epoch=generation.current,value=await localRequest<LocalState>("cancel");setState(value);
      setExplanationOwner({id,key:"",epoch,revision:value.revision,status:"cancelled"});
    });
  }
  function choose(message: LocalMessage,inline=false) {
    if(!initialized||busy||quickFlight.current||!canExplainMessage(state.messages.find(m=>m.id===message.id)))return;
    const chosen=selectLocalContextMessages(state.messages,message.id);
    const included=chosen.map(m => ({ label: m.id, text: `${m.speaker}: ${m.text || m.visual?.alt || m.generated?.alt || t("[Visual only]", "[仅视觉内容]")}`, timestamp: "", included: true }));
    const input:ReviewInput={version:0,intent:"",context:included,preferences:{source:"requester-reported",confirmed:true,
      outputLanguage:language,familiarity:"",formality,relationship:"",humor:"",avoid}};
    const key=JSON.stringify(input),cached=inlineAnalysis(message)?.state.status==="ready"&&explanationOwner?.key===key;
    if(!inline)showAssistant();
    if(cached)return;
    setCreating(false);resetResults(); setSelected(message.id); setCommand("explainVisual"); setIntent("");
    setContext(included);setQuickMode(direct);setSavedProfileNotice(profileDirty);
    if(!direct){void action(async () => setState(await localRequest<LocalState>("cancel")));return;}
    quickFlight.current=true;setQuickRunning(true);
    const controller=new AbortController();abort.current=controller;
    void action(()=>trackExplanation(message.id,key,()=>explainLocalMessage(localRequest,message.id,input,controller.signal)))
      .finally(()=>{quickFlight.current=false;if(mounted.current)setQuickRunning(false);});
  }
  async function prepare() {
    if(direct&&command==="explainVisual"&&!canExplainMessage(state.messages.find(m=>m.id===selected))){setError("local-visual-required");return;}
    resetResults();
    await action(async () => {
      const input: ReviewInput = unified?{version:0,intent:expression.intent,context:expression.context,
        preferences:{source:"requester-reported",confirmed:true,outputLanguage:language,...expression.preferences}}:
        { version: 0, intent, context, preferences: { source: "requester-reported", confirmed: true,
        outputLanguage: language, familiarity: "", formality, relationship: "", humor: "", avoid } };
      let current=state;
      if(command==="recommendVisual"&&internet&&!current.catalogAccepted){
        const controller=new AbortController();abort.current=controller;
        current=await localRequest<LocalState>("catalog/load",{revision:current.revision},controller.signal);setState(current);
      }
      const value = await localRequest<LocalReview>("review", { revision: current.revision, selectedId: selected, command, input });
      setState(s => ({ ...s, revision: value.revision })); setReview(value);
    });
  }
  async function process() {
    if(direct&&command==="explainVisual"&&!canExplainMessage(state.messages.find(m=>m.id===selected))){setError("local-visual-required");return;}
    if (!review || (!direct&&!consent)) return;
    const controller = new AbortController(); abort.current = controller;
    await action(async () => {
      const work=()=>localRequest<{ result: AnalysisResult; state: LocalState }>("process",
        { revision: state.revision, digest: review.processing.digest, consent: true }, controller.signal);
      if(command==="explainVisual")await trackExplanation(selected,JSON.stringify(review.input),work);
      else{const value=await work();setResult(value.result);setState(value.state);}
      setReview(undefined);setConsent(false);
    });
  }
  useEffect(()=>{
    if(!direct||!creating||!initialized||busy||!["generation-busy","generation-cooling-down"].includes(state.generation?.reason??""))return;
    const controller=new AbortController(),ticket=generation.current;
    let timer:ReturnType<typeof setTimeout>;
    const fresh=()=>!controller.signal.aborted&&mounted.current&&generation.current===ticket;
    const refresh=async()=>{
      try{
        const next=await sendLocalRequest<LocalState>("state",{},controller.signal);
        if(!fresh())return;
        setState(previous=>previous.revision===next.revision?{...previous,generation:next.generation,cooldownUntil:next.cooldownUntil}:previous);
        if(["generation-busy","generation-cooling-down"].includes(next.generation?.reason??""))timer=setTimeout(refresh,1000);
      }catch(error){if(fresh())setError(error instanceof Error?error.message:"local-network-error");}
    };
    timer=setTimeout(refresh,1000);
    return()=>{controller.abort();clearTimeout(timer);};
  },[direct,creating,initialized,busy,state.revision,state.generation?.reason,state.generation?.cooldownUntil]);
  const cooldown = Math.max(0, Math.ceil(((direct&&creating?state.generation?.cooldownUntil??0:state.cooldownUntil) - clock) / 1000));
  const errors: Record<string, string> = {
    "meme-source-unavailable":t("Imgflip is unavailable. Retry the public source explicitly; no demo images or model results were substituted.","Imgflip 暂不可用。可手动重试加载公开来源；不会用演示图片或伪造结果替代。"),
    "meme-source-invalid":t("The public source failed URL, format or metadata validation. No fallback was used.","公开来源未通过地址、格式或元数据校验，未使用替代素材。"),
    "busy": t("Another request is running or Azure service pacing is active. Wait, then explicitly retry.", "其他请求正在运行，或正在按 Azure 服务限制等待，请稍后手动重试。"),
    "insufficient-candidates": direct?t("Not enough valid local assets. No invented candidates are substituted.","有效本地素材不足，不会用虚构候选替代。"):t("Review and authorize at least six actual local test assets first. No invented candidates are substituted.", "请先审阅并确认至少六个真实素材的本地测试使用权限，不会用虚构候选替代。"),
    "model-output-invalid": direct&&command==="explainVisual"?t("The explanation failed validation. Please retry the explanation explicitly.","解释未通过校验，请手动重试解释。"):t("The model response failed validation. Nothing was inserted. Please review again.", "模型响应未通过校验，没有插入内容。请重新预览后再试。"),
    "model-output-invalid-references":t("The model cited a frame or context that was not supplied. The response was blocked; retry explicitly.","模型引用了未提供的画面或上下文，已拦截该结果。请手动重试。"),
    "model-output-invalid-schema":t("The response did not match the required explanation structure or text limits. Retry explicitly.","模型响应不符合解释结构或文字限制，请手动重试。"),
    "model-output-invalid-json":t("The model returned unreadable JSON. Retry explicitly; no automatic retry was made.","模型返回的数据不是有效 JSON，请手动重试；未自动重试。"),
    "model-output-invalid-envelope":t("The provider returned an unexpected response format or tool request. Nothing was executed; retry explicitly.","提供商返回了异常响应格式或工具请求，未执行任何操作。请手动重试。"),
    "model-provider-auth":t("Azure rejected the model credential or access. Check the local model configuration; retrying alone will not fix access.","Azure 拒绝了模型凭据或访问权限，请检查本地模型配置；仅重试不能修复权限。"),
    "model-provider-unavailable":t("Azure returned a service error. Retry explicitly later; this is not an explanation validation failure.","Azure 返回服务错误，请稍后手动重试；这不是解释内容校验失败。"),
    "model-network-error":t("The model connection failed while sending or reading the response. Retry explicitly; no automatic retry was made.","模型连接在发送请求或读取响应时失败，请手动重试；未自动重试。"),
    "model-output-truncated":t("The explanation reached its output limit and was incomplete. Shorten the optional context before retrying.","解释达到输出上限，内容不完整。可精简可选上下文后手动重试。"),
    "model-refused":t("The model declined this request. No replacement explanation was fabricated.","模型拒绝了此次请求，未用虚构解释替代。"),
    "model-contract-rejected":t("Azure rejected the model request contract. This profile is paused until the configuration is corrected.","Azure 拒绝了模型请求格式，当前配置已暂停，需修复配置后再试。"),
    "timeout":t("The model request timed out. Retry explicitly after the current request has finished.","模型请求超时，请等待当前请求结束后手动重试。"),
    "local-visual-required":t("Explain requires a picture, sticker, GIF or Unicode emoji in the selected message. Plain text can provide context.","解释需要选择包含图片、贴纸、GIF 或 emoji 的消息。普通文字可作为上下文。"),
    "processing-review-required": t("The input changed or exceeded a limit. Review the current content again.", "输入已更改或超出限制，请重新预览当前内容。"),
    "decoder-budget-exceeded": t("This image/GIF exceeds the local decoder budget. Use a smaller/shorter visual.", "图片或 GIF 超出本地解码预算，请使用更小或更短的素材。"),
    "request-token-budget-exceeded": t("Too much context for this development profile. Remove messages or shorten the reviewed text.", "上下文超出开发配置预算，请取消部分消息或缩短预览文字。"),
    "model-request-envelope-exceeded":errorByteLimit
      ?t(`This model request is ${errorByteLimit.actualBytes} bytes; the transport envelope allows ${errorByteLimit.allowedBytes} bytes. This is a per-request limit, not a room quota.`,
        `本次模型请求为 ${errorByteLimit.actualBytes} 字节，传输封包上限为 ${errorByteLimit.allowedBytes} 字节。这是单次请求边界，不是房间配额。`)
      :t("The model request exceeds the 12 MiB transport envelope, not a room quota.","模型请求超过 12 MiB 传输封包边界，不是房间配额。"),
    "local-message-capacity":t("This room has reached its 40-message count limit. This is not a media-byte quota.","本房间达到 40 条消息数量上限，不是媒体字节配额。"),
    "local-profile-capacity":t("This room has reached its 16-speaker-profile count limit. Existing profiles can still be edited.","本房间达到 16 份发言者偏好数量上限，已有偏好仍可编辑。"),
    "request-byte-budget-exceeded": t("A request, decoded-media operation or shared cache reached its byte boundary. This is not the removed personal room quota.", "某次请求、媒体解码操作或共享缓存达到字节边界，并非已移除的个人房间配额。"),
    "unsupported-format": t("Use a valid PNG, JPEG, or multi-frame GIF, at most 1 MiB.", "请选择有效的 PNG、JPEG 或多帧 GIF，最大 1 MiB。"),
    "auth-required": t("The in-memory local session expired. Reload this page.", "内存中的本地会话已过期，请刷新页面。"),
    "cancelled": t("Cancelled. Nothing was inserted.", "已取消，没有插入内容。"),
    "local-session-capacity":t("Legacy mode: All four local session slots are occupied, including rooms still finishing cancelled work. In another room you own, choose Close this room, or wait for the 30-minute session expiry, then retry. Closing a browser tab alone does not release a room. Existing rooms will not be evicted.","旧模式：四个本地会话名额已占用，包含取消后仍在收尾的房间。请在另一个属于你的房间选择“关闭本房间”，或等待 30 分钟会话过期，然后重试。仅关闭浏览器标签页不会释放房间，不会驱逐现有会话。"),
    "not-configured": t("Cannot reach the local backend. Check this URL and the current server, then retry. Do not restart other rooms.", "无法连接本地后端，请检查当前地址和服务后重试，不要重启其他房间。")
  };
  const composerErrors:Record<string,string>={
    "attachment-blocked":t("Wait for the current request or finish editing, then attach the file again. Your current attachment is unchanged.","请等待当前请求完成或结束编辑，再添加文件。现有附件未改变。"),
    "attachment-count":t("Attach one image or GIF at a time. The current attachment was kept.","一次只能添加一张图片或一个 GIF，已保留现有附件。"),
    "attachment-size":t("This file exceeds 1 MiB. Resize/compress it or shorten the GIF, then try again.","文件超过 1 MiB，请缩小或压缩图片、缩短 GIF 后再试。"),
    "attachment-pixels":t("This visual exceeds 4 million pixels. Resize it before attaching.","图片超过 400 万像素，请缩小后再添加。"),
    "attachment-read":t("Could not read the file. Choose or paste it again; your current attachment is unchanged.","无法读取文件，请重新选择或粘贴；现有附件未改变。"),
    "attachment-link":t("Drop an image file, not a web link. Web images are never fetched automatically.","请拖入图片文件，而不是网页链接。不会自动下载网页图片。"),
    "attachment-draft":t("Send or remove the draft attachment before editing another message.","请先发送或移除草稿附件，再编辑其他消息。")
  };
  const participants=[...new Set(state.messages.map(m=>m.speaker))];
  const visibleMessages=state.messages.filter(m=>`${m.speaker} ${m.text} ${m.visual?.alt??""} ${m.generated?.alt??""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const clearLabel=direct?t("Clear room","清空对话"):t("Clear room & revoke consent","清空对话并撤销确认");
  const shownCatalog=internet?state.internetCatalog:catalog;
  const sourceControls=direct&&<section className="local-info" aria-label={t("Expression source","表达素材来源")}>
    <label>{t("Expression source","表达素材来源")}<select disabled={busy||profileDirty} value={state.catalogSource??"internet"} onChange={e=>{
      const source=e.target.value;resetResults();void action(async()=>setState(await localRequest<LocalState>("catalog/source",{revision:state.revision,source})));
    }}><option value="internet">{t("Internet popular meme templates · Imgflip","网络热门梗图模板 · Imgflip")}</option>
      <option value="original-demo">{t("Original geometric demo library","原创几何演示素材库")}</option></select></label>
    {internet&&<><p>{t("Provider popular, mostly English-language templates—not all-internet or Chinese real-time trends. Images are existing static templates, often needing captions. Only public metadata/images go through Imgflip; your text and speaker reports do not.",
      "来源站热门、以英语网络文化为主的模板，不是全网或中文实时热榜。素材为现有静态模板，通常需要配文。Imgflip 仅提供公开元数据与图片，不接收你的聊天、意图或发言者报告。")}</p>
      <button className="local-secondary" disabled={busy||profileDirty} onClick={()=>{resetResults();void action(async()=>{
        const controller=new AbortController();abort.current=controller;
        setState(await localRequest<LocalState>("catalog/load",{revision:state.revision},controller.signal));
      });}}>{t("Load / refresh public templates","加载 / 刷新公开模板")}</button>
      <span role="status">{state.internetCatalog?t(`${state.internetCatalog.assets.length} templates ready` ,`${state.internetCatalog.assets.length} 个模板已就绪`):t("Not loaded; preview can load the source.","尚未加载；预览请求时也可加载来源。")}</span>
    </>}
  </section>;
  return <div className={`local-app studio-shell ${panelOpen?"ai-open":""} ${chatsOpen?"chats-open":""}`}>
    {!initialized&&<section className="local-bootstrap" aria-label={t("Local session connection","本地会话连接")}>
      <h2>{bootstrap==="closed"?t("This room is closed","本房间已关闭"):t("Connect to a local room","连接本地房间")}</h2>
      <p role={bootstrap==="failed"?"alert":"status"}>{bootstrap==="pending"?t("Opening your local session… No AI request is made.","正在打开本地会话……不会调用 AI。"):bootstrap==="closed"?t("Its content was cleared and its slot released after any running work finishes.","本房间内容已清除，运行中的任务收尾后释放名额。"):bootstrapError==="local-session-capacity"?errors[bootstrapError]:friendlyLocalError(bootstrapError,language)}</p>
      <button className="local-primary" disabled={bootstrap==="pending"} onClick={()=>void initialize()}>{bootstrap==="closed"?t("Open a new local room","打开新本地房间"):t("Retry connection","重试连接")}</button>
      <p>{t("Retry never clears another room or calls AI.","重试不会清空其他房间，也不会调用 AI。")}</p>
    </section>}
    <header className="local-header" inert={compact&&(panelOpen||chatsOpen)}><a className="local-brand" href="/chat"><span className="local-logo">VC</span><span>Visual Copilot</span></a>
      <label className="studio-search"><ChatIcon name="search"/><input aria-label={t("Search this conversation","搜索此对话")} value={search} maxLength={200} placeholder={t("Search this conversation · local only","搜索此对话 · 仅本地")} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label={t("Clear search","清除搜索")} onClick={()=>setSearch("")}><ChatIcon name="close"/></button>}</label>
      <nav><span className="local-badge">{t("Standalone prototype","独立原型")}</span>
        <select aria-label="Language / 语言" value={language} onChange={e => { setLanguage(e.target.value as Language); document.documentElement.lang = e.target.value; if(initialized)void invalidate(); }}>
          <option value="zh-CN">简体中文</option><option value="en">English</option></select>
        <span className="studio-self-avatar" title={t("One local user, simulated speakers","一位本地用户，模拟多位发言者")}>A</span></nav></header>
    <div className="local-disclosure" inert={compact&&(panelOpen||chatsOpen)}><span>{t("STANDALONE · SIMULATED","独立原型 · 模拟对话")}</span>
      <span className="studio-disclosure-short">{direct?t("Owned test content · Explain click runs AI · Nothing is sent to Teams","自有测试内容 · 点击解释即调用 AI · 不发送到 Teams"):t("Owned test content · Review before AI · Nothing is sent to Teams","自有测试内容 · 预览后调用 AI · 不发送到 Teams")}</span>
      <details><summary>{t("About this prototype","原型说明")}</summary><div>
      {direct?t(` One person plays every speaker. Use permitted non-sensitive test content. Explain supports pictures, stickers, GIFs and Unicode emoji, including text with emoji. The click sends the selected content, up to ${LOCAL_CONTEXT_LIMIT} message contexts and saved sender preferences to the configured model immediately. Plain text without emoji can provide context, not a separate Explain target. Other AI flows retain their previews. No Teams, Graph, external posting or chat storage.`,
        ` 一个人模拟所有发言者。仅使用有权使用的非敏感测试内容。解释支持图片、贴纸、GIF 和 emoji，也支持文字搭配 emoji。点击后立即将所选内容、最多 ${LOCAL_CONTEXT_LIMIT} 条消息上下文和已保存的发言者偏好发送给已配置的模型。不含 emoji 的普通文字可作为上下文，但不能单独解释。其他 AI 流程保留预览。不连接 Teams/Graph，不外发消息，不持久保存聊天。`):t(" One person plays every speaker. Use only your own permitted, non-sensitive test content. Nothing reaches the model until you review and consent. No Teams, Graph, external sending, or chat storage.",
        " 一个人模拟所有发言者。仅使用你有权使用的非敏感测试内容；预览并明确同意后才会调用模型。不连接 Teams/Graph，不外发消息，不持久保存聊天。")}</div></details></div>
    <main className="local-layout" inert={!initialized} aria-busy={bootstrap==="pending"}>
      <nav className="studio-rail" inert={compact&&(panelOpen||chatsOpen)} aria-label={t("App navigation","应用导航")}>
        <button ref={chatToggle} className="active" aria-expanded={chatsOpen||!compact} onClick={()=>{setChatsOpen(v=>!v);if(compact)setPanelOpen(false);}}><ChatIcon name="chat"/><span>{t("Chat","聊天")}</span></button>
        <button onClick={()=>setCatalogOpen(true)}><ChatIcon name="image"/><span>{t("Library","素材")}</span></button>
        <button aria-pressed={panelOpen} onClick={()=>panelOpen?hideAssistant():showAssistant()}><ChatIcon name="sparkle"/><span>Copilot</span></button>
        <a href="/manual" title={t("Old manual demo","原手动演示")}><ChatIcon name="arrow"/><span>{t("Manual","手动演示")}</span></a>
      </nav>
      {compact&&chatsOpen&&<div className="studio-scrim" onClick={hideChats}/>}
      <aside ref={chatList} className="local-sidebar" inert={compact&&panelOpen} aria-label={t("Chats","会话列表")} onKeyDown={e=>{if(compact&&chatsOpen){containFocus(e);if(e.key==="Escape")hideChats();}}}>
        <div className="studio-list-heading"><h1>{t("Chats","聊天")}</h1><span>{t("1 local room","1 个本地会话")}</span><button className="studio-mobile-only" aria-label={t("Close chats","关闭会话列表")} onClick={hideChats}><ChatIcon name="close"/></button></div>
        <p className="studio-section-label">{t("PINNED","置顶")}</p>
        <button className="studio-conversation-row" aria-current="page" onClick={()=>{setChatsOpen(false);if(compact)setPanelOpen(false);composerInput.current?.focus();}}>
          <span className="studio-room-avatar">H</span><span><strong>{t("Hackathon studio","Hackathon 创作室")}</strong><small>{state.messages.at(-1)?.text||t("A little more understanding.","让表达多一分理解。")}</small></span>
        </button>
        <p className="studio-section-label">{t("YOUR CREATIVE TOOLS","你的创作工具")}</p>
        <button className="studio-list-tool" onClick={()=>selectTool("express")}><ChatIcon name="sparkle"/><span>{t("Find a thoughtful reply","找到贴切的回应")}</span></button>
        <button className="studio-list-tool" onClick={()=>selectTool("create")}><ChatIcon name="image"/><span>{t("Make something original","创作全新视觉")}</span></button>
        <div className="studio-sidebar-bottom">
        <button className="local-secondary" disabled={busy||state.messages.length>0||!state.revision} onClick={()=>void loadDemo()}>{state.emojiExpressions?t("Load demo","载入演示"):t("Load demo conversation","载入演示对话")}</button>
        <button className="local-secondary" onClick={() => setCatalogOpen(!catalogOpen)}>{t("Review asset library", "审阅素材库")} <span>{internet?state.internetCatalog?.assets.length??0:8}</span></button>
        <p className="local-muted">{state.webCreation?.provider==="Google Images via SerpApi"?t("Create uses Google Images via SerpApi when configured. Only public search keywords are sent; rights remain unverified.","创作在配置后通过 SerpApi 搜索 Google 图片。仅发送公开搜索词，素材权利仍需核实。"):state.webCreation?.provider==="Wikimedia Commons"?t("Create uses Wikimedia Commons, a shared image library with per-file licenses. No search key required.","创作使用维基共享图片库，保留各文件许可，无需搜索密钥。"):state.webCreation?t("Find uses the selected asset library. Create uses Brave web image search when configured.","推荐现成图使用所选素材库；创作模式在配置后使用 Brave 网络图片搜索。"):internet?t("Express uses Imgflip popular templates. Load the public source explicitly; this is not a Chinese real-time hot list.","表达默认使用 Imgflip 热门模板，需点击加载公开来源；不是中文实时热榜。"):direct?t("Original geometric demo library selected explicitly.","已明确选择原创几何演示库。"):state.catalogAccepted ? t("Local-use attestation active for this session only.", "本会话的本地测试使用确认已生效。") : t("Assets await your local-use permission review.", "素材等待你审阅并确认本地测试使用权限。")}</p>
        <button className="local-text-button" onClick={clearRoom}>{clearLabel}</button>
        <button className="local-text-button" onClick={()=>void closeRoom()}>{t("Close this room","关闭本房间")}</button></div>
      </aside>
      <section className="local-chat-panel" inert={compact&&(panelOpen||chatsOpen)}><div className="local-panel-heading studio-chat-heading"><span className="studio-room-avatar">H</span><div><h2>{t("Hackathon studio","Hackathon 创作室")}</h2><span className="studio-participants">{(participants.length?participants:["Alex"]).join(", ")} · {t("simulated participants","模拟成员")}</span></div>
        <button className="studio-mobile-only mobile-chat-clear" aria-label={clearLabel} onClick={clearRoom}><ChatIcon name="trash"/></button>
        <button className="studio-panel-toggle" aria-label={t("Open AI panel","打开 AI 面板")} aria-expanded={panelOpen} onClick={showAssistant}><ChatIcon name="sparkle"/><span>Copilot</span></button></div>
        <div className="studio-chat-subhead"><span className="studio-chat-tab">{t("Conversation","对话")}</span><small>{demoLoaded||state.messages.some(m=>m.demoMedia)?        t("Authored demo · loading makes no AI call","预写演示 · 载入不调用 AI"):t("One person · every speaker is simulated","单人操作 · 所有发言者均为模拟")}</small></div>
        <div className="local-messages" ref={timeline} aria-label={t("Local conversation", "本地对话")}>
          {state.messages.length === 0 && <div className="local-empty"><div className="local-orbit">✦</div><h3>{t("A conversation starts here", "从一句话开始")}</h3>
            <p>{state.emojiExpressions?t("Try pictures, GIFs and emoji in one conversation, or add your own message. Loading the demo makes no AI call.","在同一段对话中体验图片、GIF 和 emoji，也可以添加自己的消息。载入演示不调用 AI。"):t("Add text, emoji or your own visual. Change the speaker to simulate a reply.", "添加文字、表情或自有图片，切换发言者来模拟回应。")}</p>
            <button className="local-primary" disabled={busy||!state.revision} onClick={()=>void loadDemo()}>{state.emojiExpressions?t("Start demo","开始演示"):t("Start a demo conversation","从演示对话开始")}</button>
            <button className="local-secondary" disabled={busy || !state.revision} onClick={() => void action(async () => {
              const value = await localRequest<LocalState>("message", { revision: state.revision, speaker: "Alex", text: t("Our imaginary puzzle is ready. Shall we try it together? ✨", "我们的虚构谜题准备好了，一起试试吧？✨") }); setState(value);
            })}>{t("Start with fabricated text", "添加一条虚构示例")}</button></div>}
          {search&&!visibleMessages.length&&<div className="studio-no-results" role="status">{t("No messages match this local search.","本地对话中没有匹配消息。")}<button onClick={()=>setSearch("")}>{t("Clear search","清除搜索")}</button></div>}
          {visibleMessages.map((m, i) => <Fragment key={m.id}>
            {(i===0||new Date(m.createdAt??0).toDateString()!==new Date(visibleMessages[i-1].createdAt??0).toDateString())&&<div className="studio-date-divider">{m.createdAt?new Date(m.createdAt).toLocaleDateString(language,{month:"long",day:"numeric"}):t("Local conversation","本地对话")}</div>}
            <article className={`local-message ${m.speaker==="Alex"?"outgoing":"incoming"} ${i>0&&visibleMessages[i-1].speaker===m.speaker&&Math.abs((m.createdAt??0)-(visibleMessages[i-1].createdAt??0))<300_000&&new Date(m.createdAt??0).toDateString()===new Date(visibleMessages[i-1].createdAt??0).toDateString()?"grouped":""} ${selected === m.id ? "selected" : ""}`} data-testid="chat-message">
            <div className={`local-avatar avatar-${participants.indexOf(m.speaker) % 3}`} aria-hidden="true">{m.speaker.slice(0, 2).toUpperCase()}</div><div className="local-bubble">
              <div className="local-speaker"><strong>{m.speaker}</strong>{m.createdAt&&<time dateTime={new Date(m.createdAt).toISOString()}>{new Date(m.createdAt).toLocaleTimeString(language,{hour:"2-digit",minute:"2-digit"})}</time>}</div>
              <p>{m.text}</p>{state.emojiExpressions&&<EmojiInspector key={m.text} text={m.text} language={language} analysis={inlineAnalysis(m)}/>}
              {m.attachment&&m.demoMedia==="custom-emoji"?<CustomEmojiArtwork dataUrl={m.attachment.dataUrl} language={language} analysis={inlineAnalysis(m)}/>:
                hasLocalVisual(m)&&<MessageVisual message={m} language={language} analysis={inlineAnalysis(m)}/>}
              <MessageActions language={language} busy={busy} canEdit={!m.visual} canExplain={canExplainMessage(m)} onExplain={()=>choose(m)}
                mediaInfo={(m.demoMedia||m.visual||m.generated)?<>
                  {m.demoMedia&&<p>{m.demoMedia==="custom-emoji"?t("Original custom emoji · locally authored SVG/PNG · no AI image generation or external source · local demo use","原创自定义 emoji · 本地绘制 SVG/PNG · 非 AI 生图，无外部素材 · 用于本地演示"):m.demoMedia==="user-reference"?t("Synthetic geometric publication fixture · not a film frame · not source-recognition evidence","发布版几何测试占位图 · 非电影画面 · 不能作为出处识别证据"):m.demoMedia==="local-motion"?t("Synthetic geometric test animation · illustrative placeholder, not native video · no AI call","几何测试动画 · 仅为示意占位素材，非原生视频 · 无 AI 调用"):t("Synthetic geometric test illustration · illustrative placeholder, not a live reply","几何测试插画 · 仅为示意占位素材，并非即时 AI 回复")}</p>}
                  {m.visual&&<Notice visual={m.visual} language={language}/>}
                  {m.generated&&<GeneratedMediaDetails visual={m.generated} language={language} technical={!direct}/>}
                </>:undefined}
                onEdit={()=>{if(attachment||composer.reading){composer.report("attachment-draft");return;}resetResults();setEditing(m.id);setDraft(m.text);changeSpeaker(m.speaker);if(compact)setPanelOpen(false);requestAnimationFrame(()=>composerInput.current?.focus());}}
                onRemove={()=>{ resetResults(); if (selected === m.id) setSelected(""); setContext(v => v.filter(c => c.label !== m.id)); setExpression(v=>({...v,context:v.context.filter(c=>c.label!==m.id),version:v.version+1})); void action(async () => {
                  const current=await localRequest<LocalState>("cancel");setState(current);
                  setState(await localRequest<LocalState>("remove", { revision: current.revision, id: m.id }));
                  composerInput.current?.focus();
                }); }}/>
            </div></article></Fragment>)}
        </div>
        <form className="local-composer" aria-label={t("Message composer","消息输入框")}
          onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length){e.preventDefault();composer.ingest(files);}}}
          onDragOver={e=>{if(e.dataTransfer.types.includes("Files")){e.preventDefault();e.dataTransfer.dropEffect=busy||editing?"none":"copy";}}}
          onDrop={e=>{e.preventDefault();const files=Array.from(e.dataTransfer.files);if(files.length)composer.ingest(files);else composer.report("attachment-link");}}
          onSubmit={e => { e.preventDefault();if(!initialized||busy||composer.reading||!speaker.trim()||(!draft.trim()&&!attachment))return;
            const sentDraft=draft;resetResults();composer.report("");void action(async () => {
          try{
          const value = await localRequest<LocalState>(editing ? "edit" : "message", { revision: state.revision, id: editing, speaker, text: draft, ...(!editing && attachment ? { attachment } : {}) });
          setState(value);setDraft(current=>current===sentDraft?"":current);composer.clear();setEditing("");if(fileInput.current)fileInput.current.value="";
          }catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))composer.report(error instanceof Error?error.message:"attachment-read");throw error;}
        }); }}>
          {composer.error&&<div role="alert" className="local-error">{composerErrors[composer.error]??errors[composer.error]??composer.error}</div>}
          {composer.reading&&<p role="status">{t("Reading attachment… Nothing is sent yet.","正在读取附件……尚未发送。")}</p>}
          {!panelOpen&&error&&!composer.error&&<div role="alert" className="local-error">{direct?friendlyLocalError(error,language):errors[error]??`${t("Request blocked","请求已阻止")}: ${error}`}</div>}
          <div className="local-compose-top"><label>{t("Simulated speaker", "模拟发言者")}<input disabled={!initialized} maxLength={40} value={speaker} onChange={e=>changeSpeaker(e.target.value)}/></label>
            <span className="local-muted">{editing ? t("Editing a local message", "正在编辑本地消息") : t("Only this browser room", "仅限这个本地空间")}</span></div>
          <textarea ref={composerInput} disabled={!initialized} aria-label={t("Message", "消息内容")} maxLength={2000} placeholder={t("Type a message · Shift+Enter for a new line","输入消息 · Shift+Enter 换行")} value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();if(!busy&&!composer.reading&&speaker.trim()&&(draft.trim()||attachment))e.currentTarget.form?.requestSubmit();}}}/>
          <p className="composer-hint">{t("Paste (Ctrl+V), drop or choose one PNG/JPEG/GIF · up to 1 MiB · send when ready","粘贴 (Ctrl+V)、拖入或选择一个 PNG/JPEG/GIF · 最大 1 MiB · 确认后再发送")}</p>
          {(attachment||composer.reading)&&<div className="composer-attachment">
            {attachment&&<img src={`data:${attachment.mime};base64,${attachment.base64}`} alt={t("Attachment preview","附件预览")}/>}
            <div>{attachment&&attachment.mime!=="image/gif"&&<label>{t("Visual type","视觉类型")}<select value={attachment.category} onChange={e=>composer.category(e.target.value)}><option value="image">{t("Image","图片")}</option><option value="sticker">{t("Static sticker","静态贴纸")}</option></select></label>}
              <button type="button" onClick={()=>{composer.clear();if(fileInput.current)fileInput.current.value="";}}>{t("Remove attachment","移除附件")}</button></div>
          </div>}
          <div className="local-compose-bottom"><div className="local-file"><button type="button" aria-label={t("Choose image or GIF","选择图片或 GIF")} title={t("Attach your image or GIF","附加自有图片或 GIF")} disabled={!initialized||busy||!!editing} onClick={()=>fileInput.current?.click()}><ChatIcon name="clip"/></button><input ref={fileInput} className="studio-file-input" tabIndex={-1} aria-label={t("Attach visual", "添加图片")} type="file" accept="image/png,image/jpeg,image/gif" disabled={!initialized||busy||!!editing} onChange={e => {
            const files=Array.from(e.target.files??[]);e.target.value="";if(files.length)composer.ingest(files);
          }} /></div>
            <details className="studio-emoji" ref={emojiPicker} onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();e.currentTarget.open=false;e.currentTarget.querySelector("summary")?.focus();}}}>
              <summary aria-label={t("Emoji picker","表情选择器")}><ChatIcon name="smile"/></summary>
              <div className="studio-emoji-options" aria-label={t("Emoji","表情")}>{["😊","✨","👏","💜","🎉","👍"].map(emoji=><button key={emoji} type="button" disabled={draft.length+emoji.length>2000} onClick={()=>{setDraft(v=>v+emoji);if(emojiPicker.current)emojiPicker.current.open=false;composerInput.current?.focus();}}>{emoji}</button>)}</div>
            </details>
            <button className="studio-composer-ai" type="button" disabled={busy||!state.revision} onClick={()=>selectTool("express")}><ChatIcon name="sparkle"/>{t("Help me express","帮我表达")}</button>
            {!direct&&<button className="studio-composer-ai" type="button" disabled={busy||!state.revision} onClick={()=>selectTool("create")}><ChatIcon name="image"/>{t("Create image / GIF","创作图片 / GIF")}</button>}
            <button className="local-primary studio-send" disabled={!initialized||busy||composer.reading || !speaker.trim() || (!draft.trim() && !attachment)}><ChatIcon name="send"/>{editing ? t("Save edit", "保存修改") : t("Add locally", "加入本地对话")}</button></div>
        </form>
      </section>
      {compact&&panelOpen&&<div className="studio-scrim" onClick={hideAssistant}/>}
      <section ref={assistantPanel} className="local-copilot" hidden={!panelOpen} role={compact?"dialog":undefined} aria-modal={compact&&panelOpen?true:undefined} aria-label={t("AI workspace","AI 工作区")}
        onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();hideAssistant();}else if(compact)containFocus(e);}}>
        <div className="local-panel-heading"><div><span className="local-eyebrow">VISUAL COPILOT</span><h2 ref={assistantHeading} tabIndex={-1}>{t("Understand. Express. Create.","理解 · 表达 · 创作")}</h2></div>
        <button className="studio-mobile-only" aria-label={clearLabel} onClick={clearRoom}><ChatIcon name="trash"/></button>
        <button aria-label={t("Hide AI panel","收起 AI 面板")} title={t("Hiding does not cancel a request","收起面板不会取消请求")} onClick={hideAssistant}><ChatIcon name="close"/></button></div>
        <div className="local-tabs"><button aria-pressed={!creating&&command === "explainVisual"} disabled={busy} onClick={()=>selectTool("explain")}>{t("Explain", "解释含义")}</button>
        <button aria-pressed={direct?unified:!creating&&command === "recommendVisual"} disabled={busy} onClick={()=>selectTool("express")}>{direct?t("Express","帮我表达"):t("Express", "表达意图")}</button>
        {!direct&&<button aria-pressed={creating} disabled={busy||!state.revision} onClick={()=>selectTool("create")}>{t("Create","创作")}</button>}</div>
        {error && <div role="alert" className="local-error">{direct?friendlyLocalError(error,language):errors[error] ?? `${t("Request blocked", "请求已阻止")}: ${error}`}</div>}
        {busy && <p role="status">{quickMode?t("Explaining this message…","正在解释这条消息……"):t("Processing your request…", "正在处理请求…")}</p>}
        {cooldown > 0 && <p className="local-muted" aria-live="off">{direct?t(`Please wait ${cooldown} seconds before trying again.`,`请稍等 ${cooldown} 秒再试。`):`${t("Azure service pacing: next shared request in", "Azure 服务限制：下次共享请求需等待")} ${cooldown}s`}</p>}
        <div className="local-copilot-content">
          {unified&&state.emojiExpressions&&<fieldset className="expression-kind"><legend>{t("Content type","内容类型")}</legend>
            {(["image","emoji"] as const).map(kind=><label key={kind}><input type="radio" name="expression-kind" checked={expressionKind===kind}
              onChange={()=>{setExpressionKind(kind);void invalidate();}}/>{kind==="image"?t("Images / GIFs","图片 / GIF"):t("Unicode emoji","Unicode emoji")}</label>)}
          </fieldset>}
          {unified&&<UnifiedExpression emoji={emojiMode} value={expression} creating={creating} language={language} disabled={profileDirty}
            onChange={editExpression} onMode={value=>{if(value!==creating)selectTool(value?"create":"express",false);}}
            onReload={()=>editExpression({context:expressionContext(),loaded:true})}/>}
          {direct&&quickMode&&!creating&&command==="explainVisual"&&<section aria-label={t("Quick explanation","直接解释")}>
            <p>{t(`Explain includes this message within at most ${LOCAL_CONTEXT_LIMIT} context messages and uses the sender's saved profile. Nothing is posted.`,`解释使用含所选消息在内的最多 ${LOCAL_CONTEXT_LIMIT} 条上下文及该发言者已保存的偏好，不会发布消息。`)}</p>
            {savedProfileNotice&&<p role="status">{t("Unsaved profile edits were not sent; the saved profile (or unknown) was used.","未发送尚未保存的偏好修改；使用已保存的偏好，未填写则保持未知。")}</p>}
            {!busy&&!quickRunning&&<>
              {!result&&<button className="local-primary" disabled={!canExplainMessage(state.messages.find(m=>m.id===selected))} onClick={()=>{const message=state.messages.find(m=>m.id===selected);if(message)choose(message);}}>{t("Retry explanation","重试解释")}</button>}
              <button className="local-secondary" onClick={()=>{setQuickMode(false);resetResults();}}>{t("Edit context / reanalyze","编辑上下文 / 重新分析")}</button>
            </>}
          </section>}
          {!emojiMode&&!creating&&command==="recommendVisual"&&sourceControls}
          {direct&&!creating&&(command==="recommendVisual"||!!explainedMessage)&&<SpeakerProfileEditor room={state} speaker={profileSpeaker} role={command==="explainVisual"?"sender":"outgoing"} language={language} busy={busy} onDirty={profileEditing} onSave={saveProfile}/>}
          <fieldset className="studio-ai-fields"           disabled={profileDirty&&!creating||busy&&creating&&!emojiMode}>
          {emojiMode?<LocalEmojiExpression room={state} common={expression} language={language} replyTo={emojiReply}
            blocked={profileDirty||!!editing} onState={setState} onWork={()=>{creationHasWork.current=true;}}
            onReply={id=>{setEmojiReply(id);editExpression({context:expressionContext(id??undefined),loaded:true});}}
            onInsert={text=>{
              if(composerState.current.editing)throw new Error("emoji-editing");
              const next=appendEmojiDraft(composerState.current.draft,text);
              composerState.current={...composerState.current,draft:next};setDraft(next);
              requestAnimationFrame(()=>composerInput.current?.focus());
            }}/>:creating?<LocalGenerationPanel room={state} language={language} speaker={speaker} onState={setState}
            shared={direct?{common:expression,options:creativeOptions,onOptions:setCreativeOptions,batchOptions,onBatchOptions:setBatchOptions,onWork:()=>{creationHasWork.current=true;},blocked:profileDirty,
              onReset:()=>editExpression({preferences:emptyExpression().preferences,context:expression.context.map(c=>({...c,included:false}))}),
              advanced:<><ExpressionPreferences value={expression} language={language} disabled={profileDirty} onChange={editExpression} onReload={()=>editExpression({context:expressionContext(),loaded:true})}/>
                <SpeakerProfileEditor room={state} speaker={profileSpeaker} role="outgoing" language={language} busy={busy} onDirty={profileEditing} onSave={saveProfile}/></>}:undefined}/>:<>
          {review ? <section className="local-review" aria-label={direct?t("Content confirmation","内容确认"):t("Transmission preview", "发送预览")}><h3>{direct?t("Review your selected content","确认所选内容"):t("Exactly what you are allowing", "请确认本次发送内容")}</h3>
            {direct?<><AnalysisConfirmation review={review} language={language}/><p>{t("Only your selection is used. Sent content cannot be recalled.","仅使用你的选择，已发送的内容无法撤回。")}</p></>:<>
            <p>{t("Destination: your configured developer model. This is not anonymization. Submitted content cannot be recalled.", "目的地：已配置的开发模型。预览不等于匿名化，已发送内容无法撤回。")}</p>
            <p><b>{t("Intent", "意图")}:</b> {review.input.intent || "—"}</p>
            {review.input.context.filter(c => c.included).map(c => <blockquote key={c.label}>{c.text}</blockquote>)}
            <p>{t("Language / tone / avoid", "语言 / 语气 / 避免内容")}: {review.input.preferences.outputLanguage} / {review.input.preferences.formality} / {review.input.preferences.avoid || "—"}</p>
            <div className="local-samples">{review.media.samples.map(f => <figure key={f.id}><img src={f.dataUrl} alt={`${t("Transmitted frame", "发送帧")} ${f.frameIndex}`} /><figcaption>{f.width}×{f.height} · {f.timestampMs}ms</figcaption></figure>)}</div>
            {review.generatedSource&&<p>{t("Generated visual: the owned 512px rendition is downsampled to 128px for this analysis. Fine details are lost; GIF first/last samples can miss the local animation.","生成图片：本次分析将你持有的 512 像素版本缩小到 128 像素，细节会丢失；GIF 首尾采样可能遗漏本地动画。")}</p>}
            {review.media.coverage.map((c, i) => <p key={i}>{c.mode === "sampled-stills" ? t("GIF: sampled stills only. Motion and intervening content may be missed.", "GIF：只发送采样静帧，可能遗漏动作和中间内容。") : t("Normalized still; metadata removed, pixels are not anonymized.", "已规范化的静帧；移除元数据，但像素并未匿名化。")}</p>)}
            <p className="local-muted">{review.processing.serializedBytes} bytes · {review.processing.imageCount} {t("frames", "帧")} · {t("max output", "最大输出")} {review.processing.outputReserve}</p>
            {review.catalog && <details><summary>{t("Exact candidate metadata sent to the model", "发送给模型的确切候选元数据")}</summary>
              {review.catalog.map(a => <p key={a.id}>{a.id} · {a.category}<br />{a.alt}<br />{a.tags.join(", ")}</p>)}</details>}
            {!direct&&<label className="local-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />{t("I own or may use this non-sensitive test content, and consent to this exact model request.", "我拥有或有权使用这些非敏感测试内容，并同意本次确切的模型请求。")}</label>}
            {review.input.speakerContext&&<div className="speaker-review"><strong>{t("Speaker report used","使用的发言者报告")}: {review.profileSpeaker} · {review.input.speakerContext.role}</strong><pre>{JSON.stringify(review.input.speakerContext.profile,null,2)}</pre><p>{t("Requester/audience preferences above are separate; unknown is not inferred.","以上请求者／受众偏好单独使用，未知项不作推断。")}</p></div>}</>}
            <button className="local-primary" disabled={(!direct&&!consent) || busy || cooldown > 0 || (direct&&command==="explainVisual"&&!canExplainMessage(state.messages.find(m=>m.id===selected)))} onClick={() => void process()}>{direct?(command==="explainVisual"?t("Explain with AI","AI 解释"):t("Recommend expressions","推荐表情")):t("Consent & run AI", "同意并调用 AI")}</button>
            <button className="local-secondary" disabled={busy} onClick={() => void invalidate()}>{t("Back to edit", "返回编辑")}</button>
          </section> : !result && !quickMode && <section className="local-input-review">
            {command==="explainVisual"&&!selected?<div className="studio-ai-welcome"><div className="studio-ai-mark"><ChatIcon name="sparkle"/></div>
              <h3>{direct?t("Explain a picture or emoji","解释图片或 emoji"):t("A little more understanding.","让表达多一分理解。")}</h3><p>{direct?t("Choose Explain on a picture, sticker, GIF or emoji message. Plain text without emoji can provide context, but cannot be explained on its own.","在图片、贴纸、GIF 或 emoji 消息上选择“解释一下”。不含 emoji 的普通文字可提供上下文，但不能单独解释。"):t("Choose Explain on a message to explore its context. Or start with what you want to say.","在消息上选择“解释一下”，结合上下文理解含义。也可以从你想表达的意图开始。")}</p>
              {!direct&&<><button className="studio-ai-card" onClick={()=>selectTool("express")}><ChatIcon name="chat"/><span><strong>{t("Find visual candidates","找到视觉回应")}</strong><small>{t("Three real options, with private reasons","三个真实候选，理由仅自己可见")}</small></span><ChatIcon name="arrow"/></button>
              <button className="studio-ai-card" onClick={()=>selectTool("create")}><ChatIcon name="image"/><span><strong>{t("Start an original visual","创作原创视觉")}</strong><small>{t("Your intent, a new image or local GIF","从意图创作新图，或制作本地 GIF")}</small></span><ChatIcon name="arrow"/></button>
              <p className="studio-ai-footnote">{t("Edit and preview the exact request before using AI.","调用 AI 之前，可编辑并预览确切请求。")}</p></>}
            </div>:<>
            {command === "explainVisual" && <p>{selected ? t("Selected message ready. Review or edit its context below.", "已选择消息。请在下方审阅或编辑上下文。") : direct?t("Choose Explain on a picture or emoji message to begin.","点击图片或 emoji 消息的“解释一下”开始。"):t("Choose Explain on any chat message to begin.", "点击任一消息的“解释”开始。")}</p>}
            {command==="recommendVisual"&&direct&&<p className="local-muted">{internet?t("AI ranks the reviewed template names and semantic descriptions, using your chosen context and voluntary speaker/audience reports. No template pixels are sent in this ranking request.","AI 根据你确认的上下文和自愿填写的发言者／受众偏好，对预览中的模板名称与语义描述排序；本次排序不发送模板像素。"):t("Original geometric demo source selected. Switch to Internet templates above for existing web memes.","当前为原创几何演示来源；如需现有网络梗图，请在上方切换到网络模板。")}</p>}
            {command === "recommendVisual" && !direct && !state.catalogAccepted && <div className="local-info">{t("Express needs your session-only local asset-use confirmation.", "表达功能需要先确认本会话的素材本地测试使用权限。")}<button onClick={() => setCatalogOpen(true)}>{t("Review assets", "审阅素材")}</button></div>}
            {!unified&&<><label>{t("Intent or question", "表达意图或问题")}<textarea aria-label={t("Intent or question", "表达意图或问题")} maxLength={2000} value={intent} onChange={e => setIntent(e.target.value)} placeholder={t("e.g. Offer calm encouragement, without promising success", "例如：给予平静的鼓励，但不承诺结果")} /></label>
            <label>{t("Tone preference", "语气偏好")}<select value={formality} onChange={e => setFormality(e.target.value as typeof formality)}><option value="unknown">{t("Unknown / no assumption", "未知 / 不作假设")}</option><option value="formal">{t("Formal", "正式")}</option><option value="casual">{t("Casual", "轻松")}</option></select></label>
            <label>{t("Avoid", "避免内容")}<input maxLength={300} value={avoid} onChange={e => setAvoid(e.target.value)} /></label>
            <h3>{t("Context you choose", "你选择的上下文")}</h3><p className="local-muted">{t(`Select at most ${LOCAL_CONTEXT_LIMIT} messages; edit or remove text before preview. Your chat history is kept. Speaker names are simulated, not identities.`, `最多选择 ${LOCAL_CONTEXT_LIMIT} 条消息，预览前可编辑或移除文字，聊天记录仍会保留。发言者是模拟角色，并非真实身份。`)}</p>
            {context.map((c, i) => <div className="local-context-row" key={c.label}><input aria-label={`${t("Include context", "包含上下文")} ${i + 1}`} type="checkbox" checked={c.included} onChange={e => setContext(v => v.map(x => x.label === c.label ? { ...x, included: e.target.checked } : x))} />
              <textarea aria-label={`${t("Context", "上下文")} ${i + 1}`} disabled={!c.included} maxLength={2000} value={c.text} onChange={e => setContext(v => v.map(x => x.label === c.label ? { ...x, text: e.target.value } : x))} />
              <button aria-label={`${t("Remove context", "移除上下文")} ${i + 1}`} onClick={() => setContext(v => v.filter(x => x.label !== c.label))}>×</button></div>)}</>}
            <button className="local-primary" disabled={busy || !state.revision || (command === "explainVisual" && !canExplainMessage(state.messages.find(m=>m.id===selected))) || (command === "recommendVisual" && (!(unified?expression.intent:intent).trim() || (!state.catalogAccepted&&!internet)))} onClick={() => void prepare()}>{direct?t("Review selected content","确认所选内容"):t("Preview model request", "预览模型请求")}</button>
            </>}
          </section>}
          {result?.status === "ready" && result.kind === "explanation" &&           <ExplanationPanel value={result.explanation} language={language} emoji={explainedMessage&&!hasLocalVisual(explainedMessage)?selectedEmoji(explainedMessage.text):undefined} />}
          {result?.status === "ready" && result.kind === "recommendations" && <section><h3>{t("Three possibilities. Your choice.", "三种表达，由你选择。")}</h3><p className="local-muted">{t("Reasons are private and never inserted into the conversation.", "推荐理由只在这里显示，不会插入对话。")}</p>
            <label>{t("Optional local caption", "可选本地配文")}<input maxLength={500} value={caption} onChange={e => { setCaption(e.target.value); clearInsertionPreview(); }} /></label>
            {result.candidates.map(c => <article className="local-candidate" key={c.visual.id}>            <Art visual={c.visual} language={language} /><h4>{c.visual.alt}</h4>
              <p>{c.reason}</p><p className="local-muted">{c.caution}</p><Notice visual={c.visual} language={language}/>
              <button className="local-secondary" disabled={busy} onClick={() => void action(async () => {
                const ticket=insertionEpoch.current,epoch=generation.current;await insertionQueue.current;if(ticket!==insertionEpoch.current||epoch!==generation.current)return;
                const pending=localRequest<LocalInsertPreview>("preview",{revision:state.revision,id:c.visual.id,caption,speaker});pendingInsertion.current=pending;
                try{const value=await pending;if(ticket===insertionEpoch.current)setPreview(value);}
                finally{if(pendingInsertion.current===pending)pendingInsertion.current=undefined;}
              })}>{t("Preview insertion", "预览插入")}</button></article>)}
          </section>}
          {preview && <section className="local-insert-preview" aria-label={t("Local insertion preview", "本地插入预览")}><h3>{t("Only this will enter the local chat", "仅将以下内容加入本地对话")}</h3>
            <strong>{preview.speaker}</strong><p>{preview.caption}</p>            <Art visual={preview.visual} language={language} /><Notice visual={preview.visual} language={language}/>
            <button className="local-primary" disabled={busy} onClick={() => void action(async () => { const value = await localRequest<LocalState>("insert", { revision: state.revision, handle: preview.handle }); resetResults(); setState(value); setCaption(""); setSelected(""); setContext([]); })}>{t("Insert into local chat", "插入本地对话")}</button></section>}
          {result && <button className="local-secondary" disabled={busy} onClick={() => {setQuickMode(false);void invalidate();}}>{t("New review", "重新审阅")}</button>}
          {(busy || review) && <button className="local-text-button" onClick={() => void (explanationOwner?.status==="pending"?cancelExplanation(explanationOwner.id):invalidate())}>{t("Cancel request", "取消请求")}</button>}
          </>}
          </fieldset>
        </div>
      </section>
    </main>
    <dialog className="local-library-modal" ref={libraryDialog} onCancel={e=>{e.preventDefault();setCatalogOpen(false);}}>
    {catalogOpen && <section className="local-library" aria-label={t("Local asset review", "本地素材审阅")}><header><div><span className="local-eyebrow">{internet?t("PUBLIC TEMPLATES · LOCAL PREVIEW","公开模板 · 本地预览"):t("EXACT ORIGINALS · LOCAL TEST ONLY", "确切原创素材 · 仅限本地测试")}</span><h2>{t("Know what you are using", "先了解你将使用的素材")}</h2></div><button onClick={() => setCatalogOpen(false)}>{t("Close library", "关闭素材库")}</button></header>
      {sourceControls}
      {!internet&&<p>{direct?t("These eight original geometric studies are available under your personal local-use instruction. Source and provenance remain visible. Corporate rights, public redistribution and the Teams catalog remain unapproved.",
        "根据你的个人本地使用指示，这八个原创几何素材已可直接使用。保留来源与创作说明，不代表企业权利、公开再分发或 Teams 素材库准入获批。"):t("These eight project-generated geometric studies still have pending legal/content review. Your attestation permits session-only local testing; it does not approve corporate rights, public hosting, redistribution or the Teams catalog. If you lack permission, do not confirm.",
        "这八个项目生成的几何作品仍待法律与内容审阅。你的确认仅用于本会话的本地测试，不代表企业权利批准、公开托管、再分发或 Teams 素材库准入。若无使用权限，请勿确认。")}</p>}
      <div className="local-library-grid">{shownCatalog?.assets.map(a => <article key={a.visual.id}>      <Art visual={a.visual} language={language} /><h3>{direct?a.visual.alt:a.visual.id}</h3>{!direct&&<p>{a.visual.alt}</p>}<p>{a.provenance}</p><Notice visual={a.visual} language={language}/>
        {a.visual.animationUrl && <details><summary>{t("Review animation", "查看动画")}</summary>        <Art visual={a.visual} animate language={language} /></details>}
        {!direct&&<details><summary>SHA-256</summary>{a.hashes.map(h => <p className="local-hash" key={h.file}>{h.file}<br />{h.sha256}</p>)}</details>}</article>)}</div>
      {!direct&&<><label className="local-check"><input type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} />{t("I reviewed these exact files/notices and have permission for this session's local test use. This is not a production rights approval.",
        "我已审阅这些确切文件与说明，并有权在本会话中用于本地测试。这不是生产环境的权利批准。")}</label>
      <button className="local-primary" disabled={!attest || busy} onClick={() => {resetResults();void action(async () => {setState(await localRequest<LocalState>("catalog", { revision: state.revision, digest: catalog!.digest, accepted: true })); setCatalogOpen(false); });}}>{t("Confirm local test use", "确认本地测试使用")}</button>
      {state.catalogAccepted && <button className="local-secondary" disabled={busy} onClick={() => {resetResults();void action(async () => {setState(await localRequest<LocalState>("catalog", { revision: state.revision, digest: catalog!.digest, accepted: false })); setAttest(false); });}}>{t("Revoke local asset use", "撤销本地素材使用")}</button>}</>}
    </section>}</dialog>
    <footer className="local-footer">{direct?t("Your conversation stays in this room. Nothing is posted automatically.","聊天仅保留在本房间，不会自动发布消息。"):t("Ephemeral by design · 127.0.0.1 only · No external send", "仅存内存 · 只监听 127.0.0.1 · 不对外发送消息")}
      {!direct&&<span data-testid="model-call-count"> · {t("Model requests", "模型请求")}: {state.providerRequests}</span>}</footer>
  </div>;
}
