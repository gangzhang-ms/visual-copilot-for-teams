import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
const canaryPath = resolve(".local", "browser-denial-canary.txt");
const server = await createServer({ configFile: resolve("vite.config.ts"), logLevel: "silent",
  server: { host: "127.0.0.1", port: 0, open: false } });
try {
  await mkdir(resolve(".local"), { recursive: true });
  await writeFile(canaryPath, "synthetic-not-a-secret-browser-denial-canary");
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const path of ["/.local/browser-denial-canary.txt", `/@fs/${canaryPath.replaceAll("\\", "/")}`]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 403);
    assert.ok(!(await response.text()).includes("synthetic-not-a-secret-browser-denial-canary"));
  }
  assert.equal((await fetch(origin + "/")).status, 200);
  process.stdout.write("Real Vite dev server denies .local (direct and /@fs) while the manual page remains available.\n");
} finally { await server.close(); await rm(canaryPath, { force: true }); }
