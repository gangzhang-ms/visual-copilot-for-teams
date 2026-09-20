import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { buildRoot } from "./build-root.mjs";
const root = resolve(import.meta.dirname, "..");
const allowedFetch = new Set(["src/client/dialog-entry.tsx", "src/client/api-client.ts", "src/client/local-chat-api.ts", "src/client/auth-entry.ts", "src/server/auth-session.ts"]);
const serverIntegrations = new Set(["src/server/auth-session.ts", "src/server/graph-context.ts", "src/server/media-resolver.ts", "src/server/model-gateway.ts", "src/server/visual-config.ts", "src/server/development-synthetic.ts", "src/server/local-chat-server.ts",
  "src/server/serpapi-image-search.ts","src/server/local-generation-config.ts","src/server/image-generation-gateway.ts","src/server/personal-image.ts","src/server/internet-memes.ts","src/server/brave-image-search.ts","src/server/commons-image-search.ts","src/server/public-search-images.ts"]);
const browserState = /\b(localStorage|sessionStorage|indexedDB|serviceWorker|sendBeacon|WebSocket|EventSource)\b/;
const forbiddenScope = /\b(cosmos|applicationinsights|opentelemetry|mixpanel|google-analytics|sendActivity|replyToActivity)\b/i;
async function walk(dir, inspect) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, inspect);
    else await inspect(path);
  }
}
function assertBoundary(name, text) {
  if (browserState.test(text) || forbiddenScope.test(text)) throw new Error(`Forbidden runtime scope in ${name}`);
  if (/\bfetch\s*\(/.test(text) && !allowedFetch.has(name)) throw new Error(`Unapproved fetch in ${name}`);
  if (/\bthis\.transport\s*\(/.test(text) && !serverIntegrations.has(name)) throw new Error(`Unapproved adapter transport in ${name}`);
  if (/\b(openai|graph\.microsoft|login\.microsoftonline)\b/i.test(text) && !serverIntegrations.has(name) && name !== "src/client/auth-entry.ts") throw new Error(`Unapproved external integration in ${name}`);
  if (name.startsWith("src/client/") && /(from\s+["'][^"']*server|CLIENT_SECRET|MODEL_API_KEY|AUTH_CLIENT_SECRET|BRAVE_SEARCH_API_KEY|SERPAPI_API_KEY|X-Subscription-Token)/.test(text)) throw new Error(`Server-only dependency in ${name}`);
  if (name.startsWith("src/client/") && /fetch\s*\(\s*["']https?:/.test(text)) throw new Error(`Direct client egress in ${name}`);
  if (/\bconsole\.(log|error|warn|debug|info)\b/.test(text)) throw new Error(`Payload-capable console logging in ${name}`);
}
for (const [name, text] of [
  ["src/client/rogue.ts", "fetch('https://arbitrary.test')"],
  ["src/client/rogue.ts", "localStorage.setItem('private', payload)"],
  ["src/client/rogue.ts", "const secret = process.env.AUTH_CLIENT_SECRET"],
  ["src/client/rogue.ts", "const secret = process.env.BRAVE_SEARCH_API_KEY"],
  ["src/client/rogue.ts", "const secret = process.env.SERPAPI_API_KEY"],
  ["src/server/rogue.ts", "this.transport(destination)"],
  ["src/server/rogue.ts", "console.log(payload)"],
  ["src/server/rogue.ts", "sendActivity(payload)"]
]) {
  let rejected = false; try { assertBoundary(name, text); } catch { rejected = true; }
  if (!rejected) throw new Error("Privacy scanner negative self-test failed.");
}
await walk(resolve(root, "src"), async (path) => {
  if (![".ts", ".tsx", ".js"].includes(extname(path)) || path.includes(".test.")) return;
  const text = await readFile(path, "utf8"); const name = relative(root, path).replaceAll("\\", "/");
  assertBoundary(name, text);
});
const manifest = await readFile(resolve(root, "package.json"), "utf8");
if (forbiddenScope.test(manifest)) throw new Error("Forbidden dependency detected.");
try {
  await walk(resolve(buildRoot, "client"), async (path) => {
    const bytes = await readFile(path); const text = bytes.toString("utf8");
    for (const needle of ["CLIENT_SECRET", "AUTH_CLIENT_SECRET", "MODEL_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPAPI_API_KEY", "X-Subscription-Token", "BOT_APP_ID", "TENANT_ID", "graph.microsoft.com", ".openai.azure.com"]) if (text.includes(needle)) throw new Error(`Server credential/config leaked into ${relative(root, path)}`);
  });
} catch (error) { if (error?.code !== "ENOENT") throw error; }
console.log("Runtime privacy, transport, dependency, logging, and client artifact boundaries validated.");
