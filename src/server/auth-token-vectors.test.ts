import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { AuthSessions, verifyEntraIdentity } from "./auth-session";
import { AnalysisSessions } from "./analysis-session";

const tenant = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333", nonce = "synthetic-transaction-nonce";
const now = new Date("2026-09-14T00:00:00Z"), seconds = now.getTime() / 1000;
const claims = { iss: `https://login.microsoftonline.com/${tenant}/v2.0`, aud: clientId, tid: tenant,
  oid: user, sub: "synthetic-subject", nonce, iat: seconds, exp: seconds + 300 };
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let key: SigningKey, wrongKey: SigningKey, jwks: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey; wrongKey = (await generateKeyPair("RS256")).privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "fixture", alg: "RS256", use: "sig" }] });
});
const sign = (changes: Record<string, unknown> = {}, signingKey = key) =>
  new SignJWT({ ...claims, ...changes }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(signingKey);
const verify = (token: string) => verifyEntraIdentity(token, jwks, { tenant, clientId, nonce }, now);

describe("offline real signatures and OIDC identity claims", () => {
  it("accepts only the locally signed, matching issuer/audience/nonce identity", async () => {
    expect(await verify(await sign())).toEqual({ tenant, user });
  });
  it.each([
    ["wrong issuer", { iss: "https://other.example.test/" }],
    ["wrong audience", { aud: "another-client" }],
    ["wrong tenant", { tid: "44444444-4444-4444-8444-444444444444" }],
    ["wrong nonce", { nonce: "another-transaction" }],
    ["expired exactly now", { exp: seconds }],
    ["not yet valid", { nbf: seconds + 1 }],
    ["future issued-at", { iat: seconds + 1 }],
    ["missing expiry", { exp: undefined }],
    ["missing issued-at", { iat: undefined }],
    ["missing subject", { sub: undefined }],
    ["missing nonce", { nonce: undefined }],
    ["missing object identity", { oid: undefined }],
    ["malformed object identity", { oid: "not-an-entra-guid" }]
  ])("rejects %s", async (_name, changes) => {
    await expect(verify(await sign(changes))).rejects.toThrow();
  });
  it("rejects invalid signature, altered payload, unknown kid and algorithm confusion", async () => {
    await expect(verify(await sign({}, wrongKey))).rejects.toThrow();
    const pieces = (await sign()).split(".");
    pieces[1] = Buffer.from(JSON.stringify({ ...claims, oid: clientId })).toString("base64url");
    await expect(verify(pieces.join("."))).rejects.toThrow();
    await expect(verify(await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "unknown" }).sign(key))).rejects.toThrow();
    await expect(verify(await new SignJWT(claims).setProtectedHeader({ alg: "HS256", kid: "fixture" }).sign(new Uint8Array(32)))).rejects.toThrow();
  });
  it("binds a genuinely verified token to the original invoking user, consuming failed state", async () => {
    const store = new AnalysisSessions(); let state = "", transactionNonce = "";
    const bootstrap = store.bootstrap({ invocationId: "signed-fixture", tenantId: tenant, userId: user,
      commandId: "explainVisual", commandContext: "message" });
    const auth = new AuthSessions(store, () => ({
      authorize: async input => { state = input.state; transactionNonce = input.nonce; return "https://synthetic.example.test"; },
      redeem: async () => ({ ...await verifyEntraIdentity(await sign({ nonce: transactionNonce, oid: clientId }), jwks,
        { tenant, clientId, nonce: transactionNonce }, now), token: "synthetic-access-token" })
    }));
    try {
      await auth.start(bootstrap);
      await expect(auth.callback(state, "synthetic-code")).rejects.toThrow("permission-denied");
      await expect(auth.callback(state, "synthetic-code")).rejects.toThrow("auth-required");
    } finally { auth.dispose(); store.dispose(); }
  });
  it("expires state at five minutes and completion at sixty seconds, erasing the session", async () => {
    let clock = 0, state = "";
    const store = new AnalysisSessions(() => clock);
    const binding = { invocationId: "fixture", tenantId: tenant, userId: user, commandId: "explainVisual" as const, commandContext: "message" as const };
    const auth = new AuthSessions(store, () => ({
      authorize: async input => { state = input.state; return "https://synthetic.example.test"; },
      redeem: async () => ({ tenant, user, token: "synthetic-access-token" })
    }), () => clock);
    try {
      await auth.start(store.bootstrap(binding)); clock = 300_000;
      await expect(auth.callback(state, "code")).rejects.toThrow("auth-required");
      const bootstrap = store.bootstrap(binding); await auth.start(bootstrap);
      const completion = await auth.callback(state, "code"); clock += 60_000;
      expect(() => auth.finish(bootstrap, completion)).toThrow("permission-denied");
    } finally { auth.dispose(); store.dispose(); }
  });
});
