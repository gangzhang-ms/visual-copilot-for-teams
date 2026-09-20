import { AuthenticationConfiguration, JwtTokenValidation, SimpleCredentialProvider } from "botframework-connector";
import type { BotConfig } from "./config";
import { HttpStatusError } from "./native-http-adapter";
export function createConnectorValidator(config: BotConfig) {
  if (config.testAuthBypass) return async () => undefined;
  const credentials = new SimpleCredentialProvider(config.clientId, config.clientSecret);
  const authentication = new AuthenticationConfiguration(["msteams"]);
  return async (body: unknown, headers: Record<string, string | string[]>) => {
    const value = headers.authorization;
    const authorization = Array.isArray(value) ? value[0] : value;
    if (!authorization) throw new HttpStatusError(401);
    try { await JwtTokenValidation.authenticateRequest(body as any, authorization, credentials, "", authentication); }
    catch { throw new HttpStatusError(401); }
  };
}
