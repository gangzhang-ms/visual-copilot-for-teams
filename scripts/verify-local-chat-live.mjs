import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import {ownedBrowserSession} from "./local-browser-session.mjs";

if (process.argv.length !== 3 || process.argv[2] !== "--run-authorized-synthetic") {
  throw new Error("Explicit --run-authorized-synthetic required: two real bounded model calls, no automatic retries.");
}
const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), results = [];
let report;
const owned=ownedBrowserSession(page,"http://127.0.0.1:4317");
try {
  await owned.start();
  await page.goto("http://127.0.0.1:4317/chat");
  await page.getByRole("button", { name: "添加一条虚构示例" }).waitFor({ state: "visible" });
  await page.getByLabel("Language / 语言").selectOption("en");
  await page.getByRole("button", { name: "Start with fabricated text" }).waitFor({ state: "visible" });
  const count = async () => Number((await page.getByTestId("model-call-count").textContent()).match(/(\d+)$/)[1]);
  const before = await count();
  const pixels = Buffer.alloc(64 * 64 * 3 * 2, 255);
  for (let frame = 0; frame < 2; frame++) for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) {
    const i = ((frame * 64 + y) * 64 + x) * 3; pixels[i] = frame ? 0 : 255; pixels[i + 1] = 0; pixels[i + 2] = frame ? 255 : 0;
  }
  const gif = await sharp(pixels, { raw: { width: 64, height: 128, channels: 3, pageHeight: 64 } }).gif({ delay: [300, 300], loop: 0 }).toBuffer();
  await page.getByLabel("Message", { exact: true }).fill("Fabricated puzzle: the square changes color. No universal meaning is defined.");
  await page.getByLabel("Attach visual").setInputFiles({ name: "original-geometric.gif", mimeType: "image/gif", buffer: gif });
  await page.getByAltText("Attachment preview").waitFor();
  await page.getByRole("button", { name: "Add locally" }).click();
  await page.getByTestId("chat-message").getByRole("button", { name: "Explain", exact: true }).click();
  await page.getByLabel("Intent or question", { exact: true }).fill("Describe only the sampled visual and uncertainty in this fabricated puzzle.");
  await page.getByRole("button", { name: "Preview model request" }).click();
  await expect(page.getByAltText(/^Transmitted frame/)).toHaveCount(2);
  assert.equal(await count(), before);
  async function run(kind) {
    await page.getByRole("checkbox", { name: "I own or may use this non-sensitive test content, and consent to this exact model request." }).check();
    const started = Date.now();
    const response = page.waitForResponse(r => r.url().endsWith("/local/process"), { timeout: 55_000 });
    await page.getByRole("button", { name: "Consent & run AI" }).click({ timeout: 75_000 });
    const value = await (await response).json();
    assert.equal(value.result?.status, "ready");
    assert.equal(value.result.kind, kind);
    if (kind === "explanation") await page.getByRole("heading", { name: "Private explanation — not actual sender intent" }).waitFor();
    else await expect(page.locator(".local-candidate")).toHaveCount(3);
    results.push({ kind, status: "ready", elapsedMs: Date.now() - started,
      ...(kind === "recommendations" ? { candidateIds: value.result.candidates.map(c => c.visual.id) } : { observations: value.result.explanation.observations.length, coverage: value.result.coverage.map(c => c.mode) }) });
  }
  await run("explanation");
  await page.getByRole("button", { name: "Express", exact: true }).click();
  await page.getByLabel("Intent or question", { exact: true }).fill("Offer calm encouragement to a friend working on a fictional puzzle. Do not promise success.");
  await page.getByRole("button", { name: "Review assets", exact: true }).click();
  const library = page.getByRole("region", { name: "Local asset review" });
  assert.equal(await library.locator("article").count(), 8);
  await library.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm local test use" }).click();
  await page.getByRole("button", { name: "Preview model request" }).click();
  // Browser consent button also enforces the server's 61-second developer cooldown.
  await new Promise(resolve => setTimeout(resolve, 62_000));
  await run("recommendations");
  await expect(page.locator(".local-candidate")).toHaveCount(3);
  await page.getByLabel("Optional local caption").fill("One small step at a time.");
  await page.getByRole("button", { name: "Preview insertion", exact: true }).first().click();
  assert.equal(await page.getByTestId("chat-message").count(), 1);
  await page.getByRole("button", { name: "Insert into local chat" }).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(2);
  assert.equal((await count()) - before, 2);
  await mkdir(".local\\visual-context", { recursive: true });
  await page.screenshot({ path: ".local\\visual-context\\local-chat-canary.png", fullPage: true });
  report = { recordedAt: new Date().toISOString(), scope: "local-interactive-self-authored-canary",
    apiVersion: "2024-10-21", providerRequestDelta: 2, browserRouteInterception: false, retries: 0,
    input: "Original generated 64x64 two-frame geometric GIF and fabricated text only",
    assetUse: "Explicit session-only test attestation for project-generated geometric studies; no production rights approval",
    manualLocalInsertions: 1, results };
} finally {
  try{const state=await owned.close();if(report)report.ownRoomClosed=state.closed;}
  catch(error){if(report){report.cleanupFailed=true;report.ownRoomClosed=false;}throw error;}
  finally{
    await context.close();await browser.close();
    if(report){await writeFile(".local\\visual-context\\local-chat-live-report.json",JSON.stringify(report,null,2)+"\n");process.stdout.write(JSON.stringify(report,null,2)+"\n");}
  }
}
