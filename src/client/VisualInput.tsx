import { useRef, useState } from "react";
import type { Language, MediaPreview, VisualCategory } from "../shared/types";
import { text } from "./visual-i18n";
export interface UploadVisual { id?: string; base64?: string; mime: string; category: VisualCategory; window?: [number, number]; crop?: { left: number; top: number; width: number; height: number } }
export function VisualInput({ language, media, busy, hosted, normalize, remove }: {
  language: Language; media?: MediaPreview; busy: boolean; hosted: { id: string; label: string }[];
  normalize: (assets: UploadVisual[]) => void; remove: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]), [category, setCategory] = useState<VisualCategory>("image");
  const fileInput = useRef<HTMLInputElement>(null);
  const [ids, setIds] = useState<string[]>([]), [error, setError] = useState("");
  const [crop, setCrop] = useState(""), [window, setWindow] = useState("");
  const prepare = async () => {
    try {
      setError("");
      if (files.length + ids.length > 2) throw new Error(text(language, "Choose at most two assets.", "最多选择两个素材。"));
      const bounds = crop ? crop.split(",").map(Number) : undefined, interval = window ? window.split(",").map(Number) : undefined;
      if (bounds && (bounds.length !== 4 || bounds.some(n => !Number.isInteger(n) || n < 0)) || interval && (interval.length !== 2 || interval.some(n => !Number.isFinite(n)))) throw new Error("Invalid crop/window");
      const options = { category, ...(bounds ? { crop: { left: bounds[0], top: bounds[1], width: bounds[2], height: bounds[3] } } : {}),
        ...(interval ? { window: interval as [number, number] } : {}) };
      const assets: UploadVisual[] = ids.map(id => ({ id, mime: "", ...options }));
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) throw new Error("10 MiB maximum per asset");
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        assets.push({ base64: btoa(binary), mime: file.type, ...options });
      }
      normalize(assets);
    } catch (e) { setError((e as Error).message); }
  };
  return <section className="panel"><h2>{text(language, "Visuals and exact pixel review", "视觉素材与准确像素预览")}</h2>
    <p>{text(language, "Images, screenshots, memes, stickers and GIFs; Unicode emoji can stay in the text. Choose at most two assets. Uploads are manual, not proof of Teams retrieval.", "支持图片、截图、表情图、贴纸和 GIF；Unicode 表情可保留在文本中。最多两个素材。上传属于手动输入，不代表已从 Teams 获取。")}</p>
    <label>{text(language, "Category", "类别")}<select value={category} onChange={e => { setCategory(e.target.value as VisualCategory); remove(); }}>
      {(["image", "screenshot", "meme", "sticker", "gif"] as const).map((v, i) => <option key={v} value={v}>{text(language, v, ["图片", "截图", "表情图", "贴纸", "GIF"][i])}</option>)}</select></label>
    {hosted.map(h => <label key={h.id}><input type="checkbox" checked={ids.includes(h.id)} onChange={e => { setIds(e.target.checked ? [...ids, h.id] : ids.filter(id => id !== h.id)); remove(); }} />{h.label}</label>)}
    <label>{text(language, "Manual replacement files", "手动替换文件")}<input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/gif" onChange={e => { setFiles(Array.from(e.target.files ?? [])); remove(); }} /></label>
    <label>{text(language, "Optional crop: left,top,width,height (pixels)", "可选裁剪：左,上,宽,高（像素）")}<input value={crop} onChange={e => { setCrop(e.target.value); remove(); }} /></label>
    <label>{text(language, "Optional GIF window: start,end (milliseconds; ≤20 seconds)", "可选 GIF 范围：起始,结束（毫秒；不超过20秒）")}<input value={window} onChange={e => { setWindow(e.target.value); remove(); }} /></label>
    <button disabled={busy || files.length + ids.length === 0} onClick={() => void prepare()}>{text(language, "Normalize on app server and review", "在应用服务器规范化并预览")}</button>
    <button disabled={busy} onClick={() => { setFiles([]); setIds([]); if (fileInput.current) fileInput.current.value = ""; remove(); }}>{text(language, "Remove pixels", "移除像素")}</button>
    {error && <p role="alert">{error}</p>}
    {media?.samples.map(s => <figure key={s.id}><img src={s.dataUrl} alt={`${s.id}, ${s.timestampMs} ms`} width={240} /><figcaption>{s.id}: {s.timestampMs} ms · {s.width}×{s.height}</figcaption></figure>)}
    {media?.coverage.map((c, i) => <p key={i}>{c.mode} · {c.window.join("–")} ms · {text(language, c.limitation, c.mode === "sampled-stills" ? "仅为抽样静帧；可能遗漏期间内容、运动和时间信息，不代表完整 GIF 理解。" : "单张规范化图片；元数据已移除，但像素并未匿名化。")}</p>)}
  </section>;
}
