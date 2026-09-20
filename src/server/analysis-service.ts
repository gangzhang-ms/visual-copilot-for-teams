import type { AnalysisResult, ReviewInput, VisualCategory } from "../shared/types";
import type { CatalogAsset } from "../catalog/visual-catalog";
import { AnalysisSessions, type AnalysisSession } from "./analysis-session";
import { GraphContext, selectedPath } from "./graph-context";
import { loadAudience } from "./audience-context";
import { MediaResolver } from "./media-resolver";
import { normalizeMedia, type SourceVisual } from "./media-normalizer";
import { buildProcessingReview, ModelGateway, validateProcessingExplanation } from "./model-gateway";
import { eligible, retrieve, validateRanking } from "./visual-retrieval";
import type { VisualConfig } from "./visual-config";
import { validMediaLimits, validProfile } from "./visual-config";
import { requireVisual, VisualError } from "./visual-errors";
export class AnalysisService {
  private jobs = 0;
  constructor(readonly sessions: AnalysisSessions, readonly config: VisualConfig, readonly graph: GraphContext,
    readonly resolver: MediaResolver, readonly gateway: ModelGateway, readonly catalog: readonly CatalogAsset[],
    private readonly permitted: typeof eligible = eligible) {}
  async loadContext(session: AnalysisSession, consent: boolean) {
    const version = session.version, result = await this.graph.load(session, consent);
    requireVisual(version === session.version && !!session.accessToken, "cancelled");
    this.sessions.invalidate(session); session.context = result; return result;
  }
  async loadAudience(session: AnalysisSession, consent: boolean) {
    const version = session.version, result = await loadAudience(this.graph, session, consent);
    requireVisual(version === session.version && !!session.accessToken, "cancelled");
    this.sessions.invalidate(session); session.audience = result; return result;
  }
  async normalize(session: AnalysisSession, input: { id?: string; base64?: string; mime: string; category: VisualCategory; window?: [number, number]; crop?: SourceVisual["crop"] }[]) {
    requireVisual(Array.isArray(input) && input.length <= 2 && this.jobs < 8, "busy");
    requireVisual(validProfile(this.config.profile, Date.now(), this.config.executionScope) && validMediaLimits(this.config.mediaLimits, this.config.executionScope), "model-capability-unverified");
    this.sessions.invalidate(session); const version = session.version, signal = session.abort.signal; this.jobs++;
    try {
      const sources: SourceVisual[] = [];
      for (const [index, i] of input.entries()) {
        requireVisual(["image", "screenshot", "meme", "sticker", "gif"].includes(i.category), "unsupported-format");
        const source = i.id ? await this.resolver.download(session, i.id) : { bytes: Buffer.from(i.base64 ?? "", "base64"), mime: i.mime };
        sources.push({ ...source, id: i.id ?? `manual-${index}`, category: i.category, window: i.window, crop: i.crop });
      }
      const media = await normalizeMedia(sources, this.config.profile, this.config.mediaLimits, signal, this.config.executionScope);
      requireVisual(!signal.aborted && version === session.version && !!session.accessToken, "cancelled");
      session.media = media; return media;
    } finally { this.jobs--; }
  }
  review(session: AnalysisSession, input: ReviewInput) {
    requireVisual(input && typeof input.intent === "string" && input.intent.length <= 2000 && Array.isArray(input.context), "processing-review-required");
    requireVisual(input.preferences?.source === "requester-reported" && input.preferences.confirmed === true
      && ["unknown", "formal", "casual"].includes(input.preferences.formality), "processing-review-required");
    requireVisual(["familiarity", "relationship", "humor", "avoid"].every(k => typeof (input.preferences as any)[k] === "string" && (input.preferences as any)[k].length <= 300), "processing-review-required");
    requireVisual(Object.keys(input.preferences).sort().join(",") === "avoid,confirmed,familiarity,formality,humor,outputLanguage,relationship,source", "processing-review-required");
    requireVisual(input.context.every(c => typeof c.text === "string" && typeof c.label === "string" && typeof c.included === "boolean"), "processing-review-required");
    this.sessions.invalidate(session); const review = structuredClone({ ...input, version: session.version });
    const media = session.media ?? { samples: [], coverage: [] };
    requireVisual(!!review.intent.trim() || media.samples.length > 0 || review.context.some(c => c.included && c.text.trim()), "processing-review-required");
    requireVisual(validProfile(this.config.profile, Date.now(), this.config.executionScope), "model-capability-unverified");
    const pool = session.binding.commandId === "recommendVisual" ? retrieve(this.catalog, input.intent, Date.now(), this.permitted) : undefined;
    const built = buildProcessingReview(review, media, this.config.profile, pool, this.config.executionScope);
    session.review = review; session.processing = built.review; session.requestBody = built.body; session.candidatePool = pool ? structuredClone(pool) : undefined; return built.review;
  }
  async process(session: AnalysisSession, consentDigest: string): Promise<AnalysisResult> {
    requireVisual(session.processing && session.review && session.requestBody && session.processing.digest === consentDigest, "processing-review-required");
    requireVisual(this.jobs < 8, "busy"); this.jobs++;
    const version = session.version, cancelled = session.abort.signal, signal = AbortSignal.any([cancelled, AbortSignal.timeout(45_000)]), snapshot = structuredClone(session.processing), input = structuredClone(session.review), body = session.requestBody;
    delete session.processing; delete session.requestBody;
    try {
      if (session.binding.target?.selectedId) requireVisual(session.sources.has(selectedPath(session.binding.target)), "processing-review-required");
      await this.graph.revalidate(session, signal);
      requireVisual(!signal.aborted && version === session.version, "cancelled");
      const output = await this.gateway.run(body, snapshot, signal);
      requireVisual(!signal.aborted && version === session.version && session.expiresAt > Date.now(), "cancelled");
      if (session.binding.commandId === "recommendVisual") requireVisual(Object.keys(output).join(",") === "candidates", "model-output-invalid");
      if (session.candidatePool) requireVisual(session.candidatePool.every(a => {
        const current = this.catalog.find(c => c.public.id === a.public.id);
        return current && this.permitted(current) && JSON.stringify(current) === JSON.stringify(a);
      }), "asset-rights-unavailable");
      const result: AnalysisResult = session.binding.commandId === "recommendVisual"
        ? { status: "ready", kind: "recommendations", candidates: validateRanking(output.candidates, session.candidatePool ?? [], this.permitted), profileVersion: snapshot.profileVersion }
        : { status: "ready", kind: "explanation", explanation: validateProcessingExplanation(output, snapshot.media.samples.map(f => f.id), input.context.filter(c => c.included).map(c => c.label),JSON.parse(body).response_format.type==="json_schema"), coverage: snapshot.media.coverage, profileVersion: snapshot.profileVersion };
      session.result = result; return result;
    } catch (error) {
      const wasCancelled = cancelled.aborted, timedOut = signal.aborted;
      this.sessions.invalidate(session);
      if (timedOut) throw new VisualError(wasCancelled ? "cancelled" : "timeout");
      throw error;
    }
    finally { this.jobs--; }
  }
}
