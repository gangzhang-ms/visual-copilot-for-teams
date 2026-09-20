import type { ContextSnippet, Language } from "../shared/types";
import { text } from "./visual-i18n";
export function ContextReview({ snippets, language, change }: { snippets: ContextSnippet[]; language: Language; change: (s: ContextSnippet[]) => void }) {
  return <section className="panel"><h2>{text(language, "Review and redact context", "检查并编辑上下文")}</h2>
    {snippets.map((s, i) => <div key={s.label}><label><input type="checkbox" checked={s.included} onChange={e => change(snippets.map((x, j) => j === i ? { ...x, included: e.target.checked } : x))} />{s.label} {s.timestamp}</label>
      <textarea aria-label={s.label} value={s.text} maxLength={8000} onChange={e => change(snippets.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
      <button onClick={() => change(snippets.filter((_, j) => j !== i))}>{text(language, "Remove", "移除")}</button></div>)}
    <button onClick={() => change([])}>{text(language, "Remove all context", "移除所有上下文")}</button>
  </section>;
}
