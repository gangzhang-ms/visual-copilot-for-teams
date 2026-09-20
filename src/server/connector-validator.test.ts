import { JwtTokenValidation } from "botframework-connector";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBotConfig } from "./config";
import { createConnectorValidator } from "./connector-validator";
const config = loadBotConfig({ TEAMS_APP_ID: "11111111-1111-4111-8111-111111111111", CLIENT_ID: "22222222-2222-4222-8222-222222222222", TENANT_ID: "33333333-3333-4333-8333-333333333333", CLIENT_SECRET: "protected-development-secret", PUBLIC_ORIGIN: "https://emoji.example.test" });
afterEach(() => vi.restoreAllMocks());
describe("official Connector endorsement validation", () => {
  it("requires auth and calls the official validator with msteams endorsement", async () => {
    const validate = vi.spyOn(JwtTokenValidation, "authenticateRequest").mockResolvedValue({} as any);
    await createConnectorValidator(config)({ channelId: "msteams" }, { authorization: "Bearer fixture" });
    expect(validate).toHaveBeenCalledOnce();
    expect(validate.mock.calls[0][4]?.requiredEndorsements).toEqual(["msteams"]);
  });
  it("rejects missing authorization before validation", async () => {
    await expect(createConnectorValidator(config)({}, {})).rejects.toMatchObject({ status: 401 });
  });
});
