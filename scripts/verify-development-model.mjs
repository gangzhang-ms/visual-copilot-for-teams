import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { builtUrl } from "./build-root.mjs";
const { runDevelopmentSynthetic } = await import(builtUrl("development-synthetic.js"));
const { loadDevelopmentModelConfig } = await import(builtUrl("development-model.js"));
const { normalizeMedia } = await import(builtUrl("media-normalizer.js"));
import sharp from "sharp";
const config = loadDevelopmentModelConfig("offline-test-key");
for (const size of [256, 257]) {
  const png = await sharp({ create: { width: size, height: size, channels: 3, background: "white" } }).png().toBuffer();
  const work = normalizeMedia([{ id: "offline-boundary", bytes: png, mime: "image/png", category: "image" }],
    config.profile, config.mediaLimits, new AbortController().signal, config.executionScope);
  if (size === 256) assert.equal((await work).samples[0].width, size);
  else await assert.rejects(work);
}
const requests = [];
const provider = async (_url, options) => {
  const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content[0].text);
  requests.push(body);
  const output = {
    background:{source:null,context:null,frames:[]},
    observations: [{ text: "Synthetic offline square and circle", frames: [input.frames[0].id] }],
    commonUsage: ["No universal meaning assumed"],
    contextualInterpretations: [{ text: "Possible puzzle instruction", context: [input.context[0].label] }],
    uncertainties: ["Synthetic fixture only"], safeResponseGuidance: ["Clarify the rules"]
  };
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }));
};
const result = await runDevelopmentSynthetic("offline-test-key", provider, async () => {});
assert.equal(result.allPassed, true);
assert.equal(result.providerRequests, 4);
assert.equal(result.graphRequests, 0);
assert.equal(new Set(requests.map(b => b.messages[1].content[1].image_url.url)).size, 1);
assert.equal(new Set(requests.map(b => b.messages[1].content[0].text)).size, 4);
assert.ok(requests.every(b => b.max_tokens === 1000 && b.messages[1].content.length === 2));
const bad = await runDevelopmentSynthetic("offline-test-key", async () => new Response(JSON.stringify({
  choices: [{ finish_reason: "stop", message: { content: '{"private-provider-canary":true}' } }]
})), async () => {});
assert.equal(bad.allPassed, false);
assert.equal(bad.providerRequests, 1);
assert.equal(bad.results[0].code, "model-output-invalid-schema");
assert.ok(!JSON.stringify(bad).includes("private-provider-canary"));
if (process.platform === "win32") {
  const secretTest = spawnSync("pwsh", ["-NoProfile", "-File", "scripts\\test-local-model-secret.ps1"], { encoding: "utf8" });
  assert.equal(secretTest.status, 0, secretTest.stderr);
  process.stdout.write(secretTest.stdout);
}
process.stdout.write("Offline development integration: actual worker/service/schema, four fixed requests, no Graph, malformed-output stop passed. No real provider calls.\n");
