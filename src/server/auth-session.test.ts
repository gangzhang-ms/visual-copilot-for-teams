import { expect, it } from "vitest";
import { AnalysisSessions } from "./analysis-session";
import { AuthSessions } from "./auth-session";
it("uses distinct PKCE/state/nonce and consumes identity-bound completion once", async () => {
  const sessions = new AnalysisSessions(); let request: any;
  const bootstrap = sessions.bootstrap({ invocationId: "i", tenantId: "t", userId: "u", commandId: "explainVisual", commandContext: "message" });
  const auth = new AuthSessions(sessions, () => ({
    authorize: async input => { request = input; return "https://login.microsoftonline.com/test"; },
    redeem: async (_code, verifier, nonce) => { expect(verifier).not.toBe(request.challenge); expect(nonce).toBe(request.nonce); return { tenant: "t", user: "u", token: "server-only" }; }
  }));
  await auth.start(bootstrap);
  expect(new Set(Object.values(request)).size).toBe(3);
  await expect(auth.callback("wrong", "code")).rejects.toThrow();
  const completion = await auth.callback(request.state, "code");
  await expect(auth.callback(request.state, "code")).rejects.toThrow();
  expect(() => auth.finish("other", completion)).toThrow();
  const capability = auth.finish(bootstrap, completion);
  expect(sessions.get(capability).accessToken).toBe("server-only");
  expect(() => auth.finish(bootstrap, completion)).toThrow();
  auth.dispose(); sessions.dispose();
});
