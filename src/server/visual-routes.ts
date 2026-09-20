import type { BotConfig } from "./config";
import type { NativeHttpAdapter } from "./native-http-adapter";
import { loadVisualConfig, visualReadiness, type VisualConfig } from "./visual-config";
import { AnalysisSessions } from "./analysis-session";
import { AuthSessions, entraProvider } from "./auth-session";
import { registerAuthRoutes, sameOrigin } from "./auth-routes";
import { GraphContext } from "./graph-context";
import { MediaResolver } from "./media-resolver";
import { ModelGateway } from "./model-gateway";
import { AnalysisService } from "./analysis-service";
import { ShareHandler } from "./share-handler";
import { visualCatalog } from "../catalog/visual-catalog";
import { eligible } from "./visual-retrieval";
import { failure, requireVisual } from "./visual-errors";
import { catalogAssetReader } from "./catalog-assets";
import { PrivacyLogger } from "./privacy-logger";
export function registerVisualRoutes(adapter: NativeHttpAdapter, bot: BotConfig, config: VisualConfig = loadVisualConfig(process.env), log = new PrivacyLogger()) {
  requireVisual(!config.executionScope || config.executionScope === "production", "model-capability-unverified");
  const sessions = new AnalysisSessions(), auth = new AuthSessions(sessions, () => entraProvider(bot, config));
  const graph = new GraphContext(config), resolver = new MediaResolver(config, graph), gateway = new ModelGateway(config);
  const service = new AnalysisService(sessions, config, graph, resolver, gateway, visualCatalog);
  const share = new ShareHandler(visualCatalog, config.shareVerified);
  adapter.registerCatalogAssets(catalogAssetReader(visualCatalog, bot.publicOrigin));
  registerAuthRoutes(adapter, bot, auth);
  const routes = {
    "/api/initial": async (s: any) => s.selected ?? { mode: "manual", context: "" },
    "/api/readiness": async () => {
      const ready = visualReadiness(config, visualCatalog.filter(a => eligible(a)).length >= 6);
      if (gateway.isSuspended()) ready.model = { ready: false, code: "model-contract-rejected" };
      return ready;
    },
    "/api/context": async (s: any, body: any) => service.loadContext(s, body.consent === true),
    "/api/audience": async (s: any, body: any) => service.loadAudience(s, body.consent === true),
    "/api/media/list": async (s: any, body: any) => resolver.list(s, body.consent === true),
    "/api/media/normalize": async (s: any, body: any) => service.normalize(s, body.assets),
    "/api/review": async (s: any, body: any) => service.review(s, body),
    "/api/explain": async (s: any, body: any) => { requireVisual(s.binding.commandId === "explainVisual", "permission-denied"); return service.process(s, body.digest); },
    "/api/recommend": async (s: any, body: any) => { requireVisual(s.binding.commandId === "recommendVisual", "permission-denied"); return service.process(s, body.digest); },
    "/api/share/prepare": async (s: any, body: any) => share.prepare(s, body.candidateId, body.caption, body.destinationConfirmed === true),
    "/api/share/invalidate": async (s: any) => { s.shareVersion++; return { invalidated: true }; },
    "/api/session/invalidate": async (s: any, body: any) => {
      sessions.invalidate(s);
      if (body.removeMedia === true) delete s.media;
      if (body.removeContext === true) { delete s.context; delete s.selected; }
      if (body.removeAudience === true) delete s.audience;
      return { version: s.version };
    },
    "/api/session/close": async () => ({ closed: true })
  };
  for (const [path, handler] of Object.entries(routes)) adapter.registerRoute("POST", path, async request => {
    try {
      sameOrigin(request, bot);
      const header = request.headers.authorization;
      requireVisual(typeof header === "string" && /^Bearer [A-Za-z0-9_-]{43}$/.test(header), "auth-required");
      const capability = header.slice(7), session = sessions.get(capability);
      const body = await handler(session, request.body);
      if (path === "/api/session/close") { sessions.close(capability); log.record("session_closed"); }
      log.record("visual_request_accepted");
      return { status: 200, body };
    } catch (error) { log.record("visual_request_blocked"); return { status: 400, body: failure(error) }; }
  });
  return { sessions, share, dispose() { share.dispose(); auth.dispose(); sessions.dispose(); } };
}
