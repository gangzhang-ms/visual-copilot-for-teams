export type CopyResult = { copied: true } | { copied: false; message: string };

export async function copyPreview(text: string, preview: HTMLTextAreaElement): Promise<CopyResult> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
    return { copied: true };
  } catch {
    preview.focus();
    preview.select();
    return { copied: false, message: "Clipboard access was denied. The preview is selected; copy it manually." };
  }
}
