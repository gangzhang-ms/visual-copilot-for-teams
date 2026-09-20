import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { digest, type AnalysisSession } from "./analysis-session";
import type { VisualConfig } from "./visual-config";
import { boundedBody, GraphContext, messageVersion, segment, selectedPath, type Transport } from "./graph-context";
import { requireVisual } from "./visual-errors";
export class MediaResolver {
  constructor(private config: VisualConfig, private graph: GraphContext, private transport: Transport = fetch) {}
  async list(session: AnalysisSession, consent: boolean) {
    const path = selectedPath(session.binding.target);
    const message = await this.graph.read(session, path, consent);
    requireVisual(!message.deletedDateTime, "media-unavailable");
    session.sources.set(path, messageVersion(message));
    const page = await this.graph.read(session, `${path}/hostedContents`, consent);
    requireVisual(Array.isArray(page.value), "media-unavailable");
    session.mediaSources.clear();
    const entries = page.value.slice(0, 20).map((item: any, i: number) => {
      requireVisual(typeof item.id === "string" && item.id.length < 512, "media-unavailable");
      const id = `selected-media-${i + 1}`;
      session.mediaSources.set(id, { path: `${path}/hostedContents/${segment(item.id)}/$value`, version: messageVersion(message) });
      return { id, label: `Selected hosted visual ${i + 1}` };
    });
    if (this.config.fileReadsApproved && Array.isArray(message.attachments) && Array.isArray(this.config.selectedFiles)) {
      for (const attachment of message.attachments.slice(0, 20)) {
        const mapping = this.config.selectedFiles.find(m => m.verified && m.selectedPath === path && m.attachmentId === attachment.id
          && typeof attachment.contentUrl === "string" && m.contentUrlDigest === digest(attachment.contentUrl));
        if (!mapping || entries.length >= 20) continue;
        const id = `selected-file-${entries.length + 1}`;
        session.mediaSources.set(id, { path, version: messageVersion(message), file: { driveId: mapping.driveId, itemId: mapping.itemId, mappingDigest: digest(JSON.stringify(mapping)) } });
        entries.push({ id, label: "Selected file visual (verified resource mapping)" });
      }
    }
    return entries;
  }
  async download(session: AnalysisSession, id: string) {
    requireVisual(this.config.graphVerified, "permission-denied");
    const source = session.mediaSources.get(id); requireVisual(source, "media-unavailable");
    await this.graph.revalidate(session);
    if (source.file) {
      const mapping = this.config.selectedFiles.find(m => digest(JSON.stringify(m)) === source.file!.mappingDigest && m.verified);
      requireVisual(mapping, "media-unavailable");
      return this.driveContent(session, source.file, [mapping]);
    }
    const signal = AbortSignal.any([session.abort.signal, AbortSignal.timeout(10_000)]);
    const response = await this.transport(`https://graph.microsoft.com/v1.0${source.path}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }, redirect: "error", signal
    });
    requireVisual(response.ok, response.status === 403 ? "permission-denied" : "media-unavailable");
    return { bytes: await boundedBody(response, 10 * 1024 * 1024, signal), mime: response.headers.get("content-type")?.split(";")[0] ?? "" };
  }
  // Only an owner-verified driveItem mapping from the selected Graph attachment may call this seam.
  async driveContent(session: AnalysisSession, reference: { driveId: string; itemId: string }, verifiedReferences: readonly { driveId: string; itemId: string }[]) {
    requireVisual(this.config.fileReadsApproved && this.config.graphVerified && verifiedReferences.some(r => r.driveId === reference.driveId && r.itemId === reference.itemId), "permission-denied");
    const signal = AbortSignal.any([session.abort.signal, AbortSignal.timeout(10_000)]);
    const response = await this.transport(`https://graph.microsoft.com/v1.0/drives/${segment(reference.driveId)}/items/${segment(reference.itemId)}/content`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }, redirect: "manual", signal
    });
    requireVisual(response.status === 302, "media-unavailable");
    const url = new URL(response.headers.get("location") ?? "");
    requireVisual(url.protocol === "https:" && !url.username && !url.password && !url.hash && (!url.port || url.port === "443")
      && this.config.downloadHosts.includes(url.hostname) && !isIP(url.hostname), "media-unavailable");
    const addresses = await lookup(url.hostname, { all: true });
    requireVisual(addresses.length && addresses.every(a => publicAddress(a.address)), "media-unavailable");
    // No authorization, cookies, redirects, or user-selected destination on preauthenticated downloads.
    return pinnedDownload(url, addresses[0].address, signal);
  }
}
function pinnedDownload(url: URL, address: string, signal: AbortSignal): Promise<{ bytes: Buffer; mime: string }> {
    return new Promise((resolve, reject) => {
      // Pin the checked address to the TLS request; a second DNS lookup would permit rebinding.
      const request = httpsRequest(url, { method: "GET", signal, lookup: (_hostname, _options, callback) => callback(null, address, 4) }, response => {
        if (response.statusCode !== 200) { response.destroy(); reject(new Error("media-unavailable")); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 10 * 1024 * 1024) { response.destroy(); reject(new Error("media-unavailable")); } else chunks.push(chunk);
        });
        response.on("end", () => resolve({ bytes: Buffer.concat(chunks), mime: String(response.headers["content-type"] ?? "").split(";")[0] }));
        response.on("error", reject);
      });
      request.on("error", reject); request.end();
    });
  }
export function publicAddress(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
}
