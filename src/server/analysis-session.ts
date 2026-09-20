import { createHash, randomBytes } from "node:crypto";
import type { AnalysisResult, AudiencePreview, ContextPreview, InvocationBinding, MediaPreview, ReviewInput, ProcessingReview, NormalizedSelectedMessage } from "../shared/types";
import { requireVisual } from "./visual-errors";
import type { CatalogAsset } from "../catalog/visual-catalog";
export const opaque = () => randomBytes(32).toString("base64url");
export const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("base64url");
export interface AnalysisSession {
  id: string; binding: InvocationBinding; accessToken: string; expiresAt: number; version: number; shareVersion: number;
  abort: AbortController; context?: ContextPreview; audience?: AudiencePreview; media?: MediaPreview;
  review?: ReviewInput; processing?: ProcessingReview; requestBody?: string; result?: AnalysisResult;
  candidatePool?: CatalogAsset[];
  selected?: NormalizedSelectedMessage;
  sources: Map<string, string>; mediaSources: Map<string, { path: string; version: string; file?: { driveId: string; itemId: string; mappingDigest: string } }>;
}
export class AnalysisSessions {
  private pending = new Map<string, { binding: InvocationBinding; selected?: NormalizedSelectedMessage; expiresAt: number }>();
  private sessions = new Map<string, AnalysisSession>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private readonly now = () => Date.now()) {
    this.timer = setInterval(() => this.cleanup(), 30_000); this.timer.unref();
  }
  bootstrap(binding: InvocationBinding, selected?: NormalizedSelectedMessage) {
    this.cleanup(); requireVisual(this.pending.size < 100, "busy");
    const token = opaque(); this.pending.set(digest(token), { binding: structuredClone(binding), selected: selected ? structuredClone(selected) : undefined, expiresAt: this.now() + 300_000 }); return token;
  }
  binding(token: string) {
    this.cleanup(); const p = this.pending.get(digest(token)); requireVisual(p, "expired"); return structuredClone(p.binding);
  }
  authenticate(token: string, tenant: string, user: string, accessToken: string) {
    this.cleanup(); const p = this.pending.get(digest(token)); requireVisual(p, "expired");
    requireVisual(p.binding.tenantId === tenant && p.binding.userId === user && !!accessToken, "permission-denied");
    requireVisual(this.sessions.size < 100, "busy");
    this.pending.delete(digest(token)); const capability = opaque();
    this.sessions.set(digest(capability), { id: opaque(), binding: p.binding, selected: p.selected, accessToken, expiresAt: this.now() + 600_000, version: 1, shareVersion: 1, abort: new AbortController(), sources: new Map(), mediaSources: new Map() });
    return capability;
  }
  get(capability: string) {
    this.cleanup(); const session = this.sessions.get(digest(capability)); requireVisual(session, "expired"); return session;
  }
  invalidate(session: AnalysisSession) {
    session.abort.abort(); session.abort = new AbortController(); session.version++; session.shareVersion++;
    delete session.processing; delete session.requestBody; delete session.result; delete session.review; delete session.candidatePool;
  }
  close(capability: string) { const s = this.sessions.get(digest(capability)); if (s) this.erase(s); this.sessions.delete(digest(capability)); }
  private erase(s: AnalysisSession) {
    s.abort.abort(); s.accessToken = ""; s.sources.clear(); s.mediaSources.clear();
    delete s.context; delete s.audience; delete s.media; delete s.review; delete s.processing; delete s.requestBody; delete s.result; delete s.candidatePool; delete s.selected;
  }
  cleanup() {
    for (const [key, p] of this.pending) if (p.expiresAt <= this.now()) this.pending.delete(key);
    for (const [key, s] of this.sessions) if (s.expiresAt <= this.now()) { this.erase(s); this.sessions.delete(key); }
  }
  dispose() { clearInterval(this.timer); for (const s of this.sessions.values()) this.erase(s); this.sessions.clear(); this.pending.clear(); }
}
