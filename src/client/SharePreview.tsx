import type { Language, SharePreviewDto } from "../shared/types";
import { PublicVisualView } from "./CandidateList";
import { text } from "./visual-i18n";
export function SharePreview({ value, language, insert, cancel }: { value: SharePreviewDto; language: Language; insert: () => void; cancel: () => void }) {
  return <section className="panel" aria-label={text(language, "Exact outgoing preview", "准确的对外预览")}><h2>{text(language, "Exact outgoing preview", "准确的对外预览")}</h2>
    <PublicVisualView visual={value.visual} caption={value.caption} /><p>{value.destination}</p>
    <p>{text(language, "Only this visual, your caption and mandatory public notices leave the dialog. Notices cannot be removed here. Native Teams Send is still required. Downstream edits/copies/caches cannot be recalled. Clipboard export is disabled.", "仅以上素材、你的说明和必需的公开声明会离开对话框。此处无法删除声明。仍需点击 Teams 原生发送按钮。无法撤回后续编辑、复制和缓存。剪贴板导出已禁用。")}</p>
    <button className="primary" onClick={insert}>{text(language, "Insert into Teams draft", "插入 Teams 草稿")}</button><button onClick={cancel}>{text(language, "Cancel", "取消")}</button>
  </section>;
}
