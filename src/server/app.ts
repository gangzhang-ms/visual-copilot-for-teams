import type { BotConfig } from "./config";
import { InvocationStore } from "./invocation-store";
import { NativeHttpAdapter } from "./native-http-adapter";
import { PrivacyLogger } from "./privacy-logger";
import { createConnectorValidator } from "./connector-validator";
import { claimInvocation } from "./invocation-route";
import { registerVisualRoutes } from "./visual-routes";
import { createBotApp } from "./bot-app";
export function createServerApp(config: BotConfig, store = new InvocationStore(), privacyLog = new PrivacyLogger()) {
  const adapter = new NativeHttpAdapter(undefined, createConnectorValidator(config), config.standaloneHarness);
  const visual = registerVisualRoutes(adapter, config, undefined, privacyLog);
  const configured = createBotApp(config, store, privacyLog, adapter, visual.share);
  configured.server.registerRoute("POST", "/api/invocations/claim", async (request) => claimInvocation(request, config, store, privacyLog, visual.sessions));
  return { app: configured, adapter, store, privacyLog, visual };
}
