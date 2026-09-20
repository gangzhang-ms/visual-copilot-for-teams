import { App } from "@microsoft/teams.apps";
import type { BotConfig } from "./config";
import { InvocationStore } from "./invocation-store";
import { handleFetchTask } from "./invoke-handler";
import { PrivacyLogger, SilentSdkLogger } from "./privacy-logger";
import { authorizeInvoke } from "./activity-authorization";
import type { NativeHttpAdapter } from "./native-http-adapter";
import type { ShareHandler } from "./share-handler";
import { requireVisual } from "./visual-errors";
export function createBotApp(config: BotConfig, store: InvocationStore, privacyLog: PrivacyLogger, adapter?: NativeHttpAdapter, shares?: ShareHandler) {
  const app = new App({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tenantId: config.tenantId,
    messagingEndpoint: "/api/messages",
    dangerouslyAllowUnauthenticatedRequests: config.testAuthBypass,
    logger: new SilentSdkLogger()
    , ...(adapter ? { httpServerAdapter: adapter } : {})
  });
  app.use((context) => { authorizeInvoke(context.activity, config); return context.next(); });
  app.on("message.ext.open", (context) => handleFetchTask(context.activity, config, store, privacyLog));
  app.on("message.ext.submit", (context) => {
    const invoke = authorizeInvoke(context.activity, config);
    const data = (context.activity as any).value?.data;
    requireVisual(shares && data && Object.keys(data).sort().join(",") === "digest,handle" && typeof data.handle === "string" && typeof data.digest === "string", "share-review-required");
    return shares.submit(data.handle, data.digest, { invocationId: invoke.invocationId, tenantId: invoke.tenantId, userId: invoke.userId,
      commandId: invoke.commandId, commandContext: invoke.commandContext, target: invoke.target }, invoke.requestId) as any;
  });
  return app;
}
