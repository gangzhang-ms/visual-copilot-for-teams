import { useRef, useState, type FormEvent } from "react";
import { recommend, validateRecommendationInput } from "../recommender/recommender";
import { tones, type RecommendationResult, type Tone } from "../shared/types";
import { copyPreview } from "./clipboard";
const abstentionText = "No suitable emoji suggestion. Add clearer English context or respond in words.";
export function App({ initialContext = "", attachmentNotice }: { initialContext?: string; attachmentNotice?: string }) {
  const [context, setContext] = useState(initialContext);
  const [tone, setTone] = useState<Tone>("balanced");
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    const input = { context, tone, locale: "en-US" as const };
    const validation = validateRecommendationInput(input);
    if (!validation.valid) { setResult(null); setMessage(validation.message); return; }
    setResult(recommend(Object.freeze({ ...input }))); setPreview("");
  };
  const reset = () => { setContext(""); setTone("balanced"); setResult(null); setPreview(""); setMessage(""); };
  const copy = async () => {
    if (!preview || !previewRef.current) return;
    const outcome = await copyPreview(preview, previewRef.current);
    setMessage(outcome.copied ? "Copied to clipboard." : outcome.message);
  };
  return <div className="app-shell">
    <header><p className="eyebrow">Legacy Unicode-only sandbox — deterministic, not connected AI</p><h1>Visual Copilot for Teams</h1><p>This sandbox suggests Unicode emoji for manual copy/paste. Images, GIFs, stickers and contextual Explain/Express belong to the separately configured local chat prototype; see the README.</p></header>
    <aside className="notice" aria-label="Privacy and language notice"><strong>English recommendations only.</strong> Context is processed only in this page’s memory. It is not stored, logged, sent to an external model, or posted to Teams. Do not paste secrets or regulated data.</aside>
    {attachmentNotice && <p className="notice" role="status">{attachmentNotice}</p>}
    <main>
      <form className="panel composer" onSubmit={submit} noValidate>
        <h2>Conversation context</h2><label htmlFor="context">Paste or type context</label>
        <textarea id="context" rows={8} maxLength={2001} value={context} aria-describedby="context-help context-count" onChange={(e) => setContext(e.target.value)} />
        <div className="field-meta"><span id="context-help">1–2,000 characters; processed in memory only.</span><span id="context-count">{context.length}/2,000</span></div>
        <fieldset><legend>Tone</legend><div className="tone-options">{tones.map((option) => <label key={option}><input type="radio" name="tone" checked={tone === option} onChange={() => setTone(option)} />{option[0].toUpperCase() + option.slice(1)}</label>)}</div></fieldset>
        <div className="actions"><button className="primary" type="submit">Get suggestions</button><button type="button" onClick={reset}>Reset</button></div>
        {message && <p role="status" className="status">{message}</p>}
      </form>
      <section className="panel results" aria-live="polite" aria-atomic="true">
        <h2>Suggestions</h2>{!result && <p>Enter context to see up to three suggestions.</p>}
        {result?.status === "abstained" && <div className="abstention"><h3>No suggestion</h3><p>{abstentionText}</p></div>}
        {result?.status === "recommendations" && <ol className="suggestions">{result.items.map((item) => <li key={item.id}>
          <button className="suggestion" type="button" onClick={() => { setPreview(item.emoji); setMessage(`${item.label} selected for preview.`); }}><span className="emoji" role="img" aria-label={item.altText}>{item.emoji}</span><span><strong>{item.label}</strong><small>{item.meaning}</small></span></button>
          <dl><div><dt>Appropriate when</dt><dd>{item.appropriateWhen}</dd></div><div><dt>Caution</dt><dd>{item.caution}</dd></div><div><dt>Why</dt><dd>{item.rationaleTemplate}</dd></div></dl>
        </li>)}</ol>}
        <div className="preview"><label htmlFor="preview">Copy/paste preview</label><textarea ref={previewRef} id="preview" rows={2} readOnly value={preview} /><button type="button" disabled={!preview} onClick={() => void copy()}>Copy preview</button></div>
      </section>
    </main><footer>This app never posts, reacts, or injects text automatically.</footer>
  </div>;
}
