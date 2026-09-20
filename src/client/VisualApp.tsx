import { useEffect, useRef, useState } from "react";
import type { AnalysisResult, AudiencePreferences as Preferences, AudiencePreview, ClaimResponse, ContextPreview, ContextSnippet, Language, MediaPreview, NormalizedSelectedMessage, ProcessingReview, Readiness, SharePreviewDto } from "../shared/types";
import type { HostAdapter } from "../host/host-adapter";
import { VisualApi } from "./api-client";
import { initialPreferences, text } from "./visual-i18n";
import { ContextReview } from "./ContextReview";
import { AudiencePreferences } from "./AudiencePreferences";
import { VisualInput } from "./VisualInput";
import { ExplanationPanel } from "./ExplanationPanel";
import { CandidateList } from "./CandidateList";
import { SharePreview } from "./SharePreview";
export function VisualApp({ claim, host }: { claim: ClaimResponse; host: HostAdapter }) {
  const api = useRef(new VisualApi()).current, generation = useRef(0);
  const shareGeneration = useRef(0);
  const inserting = useRef(false);
  const [language, setLanguage] = useState<Language>("en"), [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState<Readiness>(), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [intent, setIntent] = useState(""), [context, setContext] = useState<ContextSnippet[]>(claim.selected.context ? [{ label: "Selected snapshot (not revalidated)", text: claim.selected.context, timestamp: "", included: true }] : []);
  const [audience, setAudience] = useState<AudiencePreview>(), [preferences, setPreferences] = useState<Preferences>(initialPreferences);
  const [media, setMedia] = useState<MediaPreview>(), [hosted, setHosted] = useState<{ id: string; label: string }[]>([]);
  const [mediaEpoch, setMediaEpoch] = useState(0);
  const [review, setReview] = useState<ProcessingReview>(), [result, setResult] = useState<AnalysisResult>(), [share, setShare] = useState<SharePreviewDto>();
  const [candidateId, setCandidateId] = useState(""), [caption, setCaption] = useState(""), [destinationConfirmed, setDestinationConfirmed] = useState(false);
  const t = (en: string, zh: string) => text(language, en, zh);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(`${(error as Error).message} — ${t("Review readiness or reopen. Nothing was sent.", "请检查就绪状态或重新打开。未发送任何内容。")}`); }
    finally { setBusy(false); }
  };
  const resetDerived = () => { generation.current++; shareGeneration.current++; api.cancel(); setReview(undefined); setResult(undefined); setShare(undefined); setCandidateId(""); setDestinationConfirmed(false); };
  const invalidate = (remove: { removeMedia?: boolean; removeContext?: boolean; removeAudience?: boolean } = {}) => {
    resetDerived();
    if (signedIn) void run(async () => { await api.call("/api/session/invalidate", remove); });
  };
  useEffect(() => {
    const close = () => { if (inserting.current) return; generation.current++; void api.close().catch(() => undefined); };
    window.addEventListener("pagehide", close);
    const timer = window.setTimeout(() => { close(); setSignedIn(false); setResult(undefined); setMedia(undefined); setHosted([]); setMediaEpoch(n => n + 1); setContext([]); setAudience(undefined); setIntent(""); setCaption(""); setShare(undefined); setReview(undefined); setPreferences(initialPreferences()); setMessage("expired"); }, 600_000);
    return () => { window.removeEventListener("pagehide", close); clearTimeout(timer); };
  }, [api]);
  const login = () => run(async () => {
    const completion = await host.authenticate(claim.bootstrap!);
    const { capability } = await api.call<{ capability: string }>("/api/auth/finish", { bootstrap: claim.bootstrap, completion });
    api.setCapability(capability); setSignedIn(true); setReady(await api.call<Readiness>("/api/readiness"));
    const selected = await api.call<NormalizedSelectedMessage>("/api/initial");
    if (selected.context) setContext([{ label: "Selected snapshot (not revalidated)", text: selected.context, timestamp: "", included: true }]);
  });
  const cancel = () => { resetDerived(); if (signedIn) void run(async () => { await api.call("/api/session/invalidate"); }); };
  const invalidateShare = () => { shareGeneration.current++; setShare(undefined); if (signedIn) void run(async () => { await api.call("/api/share/invalidate"); }); };
  return <div className="app-shell visual-app"><header><h1>Visual Context for Teams</h1>
    <label>{t("UI language", "界面语言")}<select value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
    <h2>{claim.command === "explainVisual" ? t("Explain this visual privately", "私密解释此视觉素材") : t("Express this — find three candidates", "表达此意 — 查找三个候选素材")}</h2>
  </header>
    <aside className="notice">{t("H01–H04 live verification gates remain required. Retrieval sends requests to Graph only after sign-in and your separate choice. Normalization sends chosen pixels to this app server. Model processing requires a second explicit consent and organizational processor approval. Pixels are not anonymized; withdrawal cannot recall transmitted input. No private data is persisted by this app.", "仍须完成 H01–H04 真实环境验证。登录并另行选择后才向 Graph 请求数据。规范化会将所选像素发送到本应用服务器。模型处理需要再次明确同意以及组织对处理方的批准。像素并未匿名化；撤回同意无法收回已传输的内容。本应用不持久保存私密数据。")}</aside>
    {!signedIn && <button disabled={busy} onClick={() => void login()}>{t("Sign in with Teams popup", "通过 Teams 弹窗登录")}</button>}
    {ready && <section className="panel"><h2>{t("Capability readiness", "能力就绪状态")}</h2><ul>{Object.entries(ready).map(([key, value]) => <li key={key}>{key}: {value.ready ? t("Configured (live evidence still required)", "已配置（仍须真实环境证据）") : value.code}</li>)}</ul></section>}
    <p role="status" aria-live="polite">{busy ? t("Working privately…", "正在私密处理中…") : message}</p>
    <div className="actions"><button disabled={!signedIn} onClick={cancel}>{t("Cancel processing", "取消处理")}</button>
      <button onClick={() => { cancel(); setIntent(""); setContext([]); setAudience(undefined); setMedia(undefined); setHosted([]); setMediaEpoch(n => n + 1); setPreferences(initialPreferences()); setCaption(""); setSignedIn(false); void api.close().catch(() => undefined); }}>{t("Reset / close session", "重置 / 关闭会话")}</button></div>
    <main aria-busy={busy}>
      <section className="panel"><h2>{t("Separate retrieval choices", "独立的数据获取选择")}</h2>
        <button disabled={!signedIn || busy || !ready?.context.ready} onClick={() => void run(async () => {
          resetDerived(); const version = generation.current; const value = await api.call<ContextPreview>("/api/context", { consent: true });
          if (version === generation.current) { setContext(value.snippets); setMessage(`${value.provenance} · ${value.partial ? t("Partial context", "部分上下文") : t("Bounded context", "限定范围的上下文")}`); }
        })}>{t("Load context — I authorize retrieval", "加载上下文 — 我授权获取")}</button>
        <button disabled={!signedIn || busy || !ready?.audience.ready} onClick={() => void run(async () => {
          resetDerived(); const version = generation.current; const value = await api.call<AudiencePreview>("/api/audience", { consent: true }); if (version === generation.current) setAudience(value);
        })}>{t("Load audience — I authorize retrieval", "加载受众 — 我授权获取")}</button>
        <button disabled={!signedIn || busy || !ready?.media.ready} onClick={() => void run(async () => {
          setHosted(await api.call("/api/media/list", { consent: true }));
        })}>{t("Load selected media — I authorize retrieval", "加载所选素材 — 我授权获取")}</button>
        {audience && <div><p>{t("Retrieved roster; it is not a visibility restriction. Snapshot: ", "已获取成员列表；这不限制实际可见范围。快照时间：")}{new Date(audience.retrievedAt).toISOString()} · {audience.partial ? t("Partial", "不完整") : ""}</p>
          <ul>{audience.members.map(m => <li key={m.label}>{m.label}: {m.display}</li>)}</ul><button onClick={() => { setAudience(undefined); invalidate({ removeAudience: true }); }}>{t("Remove audience", "移除受众")}</button></div>}
      </section>
      <section className="panel"><label>{t("Expression intent / selected emoji / your correction", "表达意图 / 所选表情 / 你的更正")}<textarea value={intent} maxLength={2000} onChange={e => { setIntent(e.target.value); invalidate(); }} /></label></section>
      <ContextReview snippets={context} language={language} change={value => { setContext(value); invalidate({ removeContext: value.length === 0 }); }} />
      <AudiencePreferences value={preferences} language={language} change={value => { setPreferences(value); invalidate(); }} />
      <VisualInput key={mediaEpoch} language={language} media={media} hosted={hosted} busy={busy || !signedIn} remove={() => { setMedia(undefined); invalidate({ removeMedia: true }); }}
        normalize={assets => void run(async () => { resetDerived(); const version = generation.current; const normalized = await api.call<MediaPreview>("/api/media/normalize", { assets }); if (version === generation.current) setMedia(normalized); })} />
      <section className="panel"><h2>{t("Processing review and separate consent", "处理预览与独立同意")}</h2>
        <button disabled={!signedIn || busy || !preferences.confirmed || !ready?.model.ready} onClick={() => void run(async () => {
          setReview(await api.call("/api/review", { version: 0, intent, context, preferences }));
        })}>{t("Prepare exact processing review (no model call)", "准备准确的处理预览（不调用模型）")}</button>
        {review && <div><p>{review.imageCount} {t("images; serialized bytes:", "张图像；序列化字节：")} {review.serializedBytes} · {t("input token bound:", "输入 token 上限：")} {review.inputTokens} · {t("reserved output:", "预留输出：")} {review.outputReserve}</p>
          <p>{t("I reviewed the exact normalized pixels, included context and confirmed preferences above. I authorize their transmission to the configured organizationally approved model (up to two identical attempts, 45-second hard deadline).", "我已检查以上准确的规范化像素、所含上下文及已确认偏好。我授权将其传输至已配置且获组织批准的模型（最多两次相同请求，45秒硬性截止）。")}</p>
          <button className="primary" disabled={busy} onClick={() => void run(async () => {
            const version = generation.current; const value = await api.call<AnalysisResult>(claim.command === "explainVisual" ? "/api/explain" : "/api/recommend", { digest: review.digest });
            if (version === generation.current) { setResult(value); setReview(undefined); setMessage(t("Private results ready below. Nothing was sent.", "私密结果已显示在下方。未发送任何内容。")); }
          })}>{claim.command === "explainVisual" ? t("I consent — explain privately", "我同意 — 私密解释") : t("I consent — find three candidates", "我同意 — 查找三个候选素材")}</button></div>}
      </section>
      {result?.status === "ready" && result.kind === "explanation" && <><ExplanationPanel value={result.explanation} language={language} />{result.coverage.map((c, i) => <p key={i}>{c.limitation}</p>)}</>}
      {result?.status === "ready" && result.kind === "recommendations" && <CandidateList candidates={result.candidates} language={language} select={id => { setCandidateId(id); invalidateShare(); }} />}
      {candidateId && <section className="panel"><label>{t("Optional public caption — can disclose private information", "可选公开说明 — 可能泄露私密信息")}<textarea maxLength={500} value={caption} onChange={e => { setCaption(e.target.value); invalidateShare(); }} /></label>
        <label><input type="checkbox" checked={destinationConfirmed} onChange={e => { setDestinationConfirmed(e.target.checked); invalidateShare(); }} />{t("I confirm the original bound chat/channel and its full audience, not only my intended recipients.", "我确认原始绑定的聊天或频道及其全部受众，而非仅我指定的接收人。")}</label>
        <button disabled={busy || !destinationConfirmed || !ready?.share.ready} onClick={() => void run(async () => {
          setShare(undefined); const revision = ++shareGeneration.current;
          const prepared = await api.call<SharePreviewDto>("/api/share/prepare", { candidateId, caption, destinationConfirmed });
          if (revision === shareGeneration.current) setShare(prepared);
        })}>{t("Prepare exact outgoing preview", "准备准确的对外预览")}</button></section>}
      {share && <SharePreview value={share} language={language} cancel={invalidateShare} insert={() => {
        try { inserting.current = true; host.insert(share.handle, share.digest, claim.teamsAppId!); setMessage(t("Submitted for draft insertion; delivery is not confirmed. Native Send is required.", "已提交插入草稿请求；未确认送达。仍需原生发送。")); }
        catch { inserting.current = false; setMessage("host-unsupported"); }
      }} />}
    </main>
  </div>;
}
