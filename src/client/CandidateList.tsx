import type { Language, PublicVisual, VisualCandidate } from "../shared/types";
import { text } from "./visual-i18n";
export function PublicVisualView({ visual, caption }: { visual: PublicVisual; caption?: string }) {
  return <div>{visual.unicode ? <span role="img" aria-label={visual.alt}>{visual.unicode}</span> : <img src={visual.imageUrl} alt={visual.alt} width={240} />}
    <p>{visual.alt}</p>{caption && <p>{caption}</p>}<div className="public-notices"><p>{visual.notices.source}</p><p>{visual.notices.creator}</p><p>{visual.notices.license}</p>
      {visual.notices.text.map((v, i) => <p key={i}>{v}</p>)}{visual.notices.links.map(l => <p key={l.url}><a href={l.url} target="_blank" rel="noreferrer noopener">{l.label}</a></p>)}</div>
    {visual.animationUrl && <p><a href={visual.animationUrl} rel="noreferrer noopener" target="_blank">GIF — approved poster/link</a></p>}
  </div>;
}
export function CandidateList({ candidates, language, select }: { candidates: VisualCandidate[]; language: Language; select: (id: string) => void }) {
  return <section className="panel"><h2>{text(language, "Three eligible candidates", "三个符合条件的候选素材")}</h2>
    <ol>{candidates.map(c => <li key={c.visual.id}><PublicVisualView visual={c.visual} /><p>{text(language, "Private reason: ", "私密推荐理由：")}{c.reason}</p>
      <p>{text(language, "Caution: ", "注意事项：")}{c.caution}</p><button onClick={() => select(c.visual.id)}>{text(language, "Select for outgoing preview", "选择并预览对外内容")}</button></li>)}</ol></section>;
}
