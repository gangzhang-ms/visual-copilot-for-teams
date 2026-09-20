import { expect, test, type Page } from "@playwright/test";
import type { FailureCode } from "../../src/shared/types";
interface FixtureOptions { missingReadiness?: boolean; failures?: Record<string, FailureCode>; deferProcessing?: boolean; wideNotices?: boolean }
async function mount(page: Page, command: "explainVisual" | "recommendVisual", options: FixtureOptions = {}) {
  const requests: string[] = [], output = { count: 0 };
  let releaseProcessing!: () => void;
  const processingGate = new Promise<void>(resolve => { releaseProcessing = resolve; });
  const visual = (id: number) => ({ id: `synthetic-${id}`, version: "1", category: "image", alt: `Synthetic visual ${id}`, imageUrl: "/fixture.png",
    notices: options.wideNotices
      ? { version: "1", source: "S".repeat(300), creator: "C".repeat(300), license: "L".repeat(300),
        text: ["义".repeat(500), "Mandatory fixture credit"], links: [{ label: "Terms", url: `https://synthetic.example.test/terms/${"a".repeat(900)}` }] }
      : { version: "1", source: "Synthetic source", creator: "Synthetic creator", license: "TEST ONLY license", text: ["Mandatory fixture credit"], links: [] } });
  await page.route("**/offline-visual-fixture", route => route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/assets/dialog.css"></head><body><div id="root"></div><script type="module" src="/offline-entry.js"></script></body></html>' }));
  await page.route("**/offline-entry.js", route => route.fulfill({ contentType: "text/javascript", body: `
    import { renderDialog } from "/assets/dialog-entry.js";
    renderDialog(${JSON.stringify({ schemaVersion: 1, invocationId: "synthetic", selected: { mode: "selected", context: "" }, bootstrap: "B".repeat(43), teamsAppId: "fixture-app", command })},
      { authenticate: async () => "${"C".repeat(43)}", insert: (handle, digest, appId) => { window.fixtureInserted = {handle,digest,appId}; }, onThemeChange: () => () => {}, initialize: async () => ({kind:"teams",theme:"default"}) });
  ` }));
  await page.route("**/fixture.png", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYfkAAAAASUVORK5CYII=", "base64") }));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname; requests.push(path);
    if (path === "/api/explain" || path === "/api/recommend") {
      output.count++;
      if (options.deferProcessing) await processingGate;
    }
    const failure = options.failures?.[path];
    if (failure) {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ status: "blocked", code: failure }) });
      return;
    }
    let value: unknown = {};
    if (path === "/api/auth/finish") value = { capability: "A".repeat(43) };
    if (path === "/api/readiness") value = Object.fromEntries(["auth", "context", "audience", "media", "model", "catalog", "share"].map(k => [k, options.missingReadiness ? { ready: false, code: "not-configured" } : { ready: true }]));
    if (path === "/api/initial") value = { mode: "selected", context: "PRIVATE_FIXTURE_CONTEXT" };
    if (path === "/api/context") value = { snippets: [{ label: "Context 1", text: "Synthetic release passed", timestamp: "2026-01-01", included: true }], partial: true, provenance: "preceding-window", retrievedAt: 1 };
    if (path === "/api/session/invalidate") value = { version: 2 };
    if (path === "/api/review") value = { version: 2, digest: "reviewed", profileVersion: "SYNTHETIC", imageCount: 0, serializedBytes: 1000, inputTokens: 1000, outputReserve: 2000, media: { samples: [], coverage: [] } };
    if (path === "/api/explain") { value = { status: "ready", kind: "explanation", profileVersion: "SYNTHETIC", coverage: [], explanation: {
      background:{source:null,context:null,frames:[]},observations: [{ text: "Synthetic visible observation", frames: ["asset-1-frame-0","asset-1-frame-11"] }], commonUsage: ["Possible conventional use"], contextualInterpretations: [{ text: "One possible reading, not sender intent", context: ["A".repeat(43),"B".repeat(43)] }],
      uncertainties: ["Missing sender intent"], safeResponseGuidance: ["Ask for clarification"] } }; }
    if (path === "/api/recommend") { value = { status: "ready", kind: "recommendations", profileVersion: "SYNTHETIC",
      candidates: [1, 2, 3].map(i => ({ visual: visual(i), reason: "PRIVATE_FIXTURE_REASON", caution: "Uncertain familiarity" })) }; }
    if (path === "/api/share/prepare") value = { handle: "prepared-handle", digest: "exact-card-digest", visual: visual(1), caption: route.request().postDataJSON().caption,
      destination: "Synthetic bound chat", expiresAt: Date.now() + 120_000, card: {} };
    try { await route.fulfill({ contentType: "application/json", body: JSON.stringify(value) }); }
    catch (error) { if (!options.deferProcessing) throw error; }
  });
  await page.goto("/offline-visual-fixture");
  return { requests, output, releaseProcessing };
}
async function signInAndConfirm(page: Page) {
  await page.getByRole("button", { name: "Sign in with Teams popup" }).click();
  await page.getByLabel("I confirm these voluntary preferences and output language.").check();
}
async function closeFixture(page: Page) {
  await Promise.all([page.waitForResponse("**/api/session/close"), page.getByRole("button", { name: "Reset / close session" }).click()]);
}
async function requestProcessing(page: Page, command: "explainVisual" | "recommendVisual") {
  await signInAndConfirm(page);
  await page.getByRole("button", { name: "Prepare exact processing review (no model call)" }).click();
  await page.getByRole("button", { name: command === "explainVisual" ? "I consent — explain privately" : "I consent — find three candidates" }).click();
}
test("offline connected explanation keeps retrieval and processing consent separate", async ({ page }) => {
  const { requests, output } = await mount(page, "explainVisual");
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Sign in with Teams popup" }).click();
  await page.getByRole("button", { name: "Load context — I authorize retrieval" }).click();
  await expect(page.getByRole("status")).toContainText("Partial context");
  expect(output.count).toBe(0);
  await page.getByLabel("I confirm these voluntary preferences and output language.").check();
  await page.getByRole("button", { name: "Prepare exact processing review (no model call)" }).click();
  expect(output.count).toBe(0);
  await page.getByRole("button", { name: "I consent — explain privately" }).click();
  await expect(page.getByRole("heading", { name: "Possible meaning" })).toBeVisible();
  const panel=page.getByRole("heading",{name:"Possible meaning",exact:true}).locator("..");
  await expect(panel.locator("li").first().locator("span")).toHaveText("Synthetic visible observation");
  await expect(panel.locator("li").first()).not.toBeVisible();
  await expect(panel.locator(".explanation-brief")).toHaveText("Possible meaning here: One possible reading, not sender intent");
  await expect(panel.locator(".explanation-background")).toHaveText("Background: The source cannot be identified confidently from the selected visual.");
  await expect(panel.locator(".explanation-background")).not.toContainText("Possible conventional use");
  await expect(panel).toContainText("One possible reading, not sender intent");
  for(const ref of ["asset-1-frame-0","asset-1-frame-11","A".repeat(43),"B".repeat(43)])await expect(panel.locator(".explanation-details")).toContainText(ref);
  expect(output.count).toBe(1);
  await page.getByRole("button", { name: "Remove all context" }).click();
  await expect(page.getByText("Synthetic visible observation")).toHaveCount(0);
  await page.getByLabel("UI language").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "自愿提供的受众偏好" })).toBeVisible();
  await Promise.all([page.waitForResponse("**/api/session/close"), page.getByRole("button", { name: "重置 / 关闭会话" }).click()]);
});
test("offline connected recommendations require exact outgoing confirmation with notices", async ({ page }) => {
  const { output } = await mount(page, "recommendVisual");
  await page.getByRole("button", { name: "Sign in with Teams popup" }).click();
  await page.getByLabel("I confirm these voluntary preferences and output language.").check();
  await page.getByRole("button", { name: "Prepare exact processing review (no model call)" }).click();
  await page.getByRole("button", { name: "I consent — find three candidates" }).click();
  expect(output.count).toBe(1);
  await expect(page.getByRole("button", { name: "Select for outgoing preview" })).toHaveCount(3);
  await page.getByRole("button", { name: "Select for outgoing preview" }).first().click();
  expect(await page.evaluate(() => (window as any).fixtureInserted)).toBeUndefined();
  await page.getByLabel("I confirm the original bound chat/channel and its full audience, not only my intended recipients.").check();
  await page.getByRole("button", { name: "Prepare exact outgoing preview" }).click();
  const preview = page.getByRole("region", { name: "Exact outgoing preview" });
  await expect(preview).toContainText("Mandatory fixture credit"); await expect(preview).not.toContainText("PRIVATE_FIXTURE_REASON");
  expect(await page.evaluate(() => (window as any).fixtureInserted)).toBeUndefined();
  await page.getByRole("button", { name: "Insert into Teams draft", exact: true }).click();
  expect(await page.evaluate(() => (window as any).fixtureInserted)).toEqual({ handle: "prepared-handle", digest: "exact-card-digest", appId: "fixture-app" });
  await expect(page.getByRole("status")).toContainText("Native Send is required");
});
for (const command of ["explainVisual", "recommendVisual"] as const) {
  test(`offline ${command}: missing readiness blocks processing and retrieval without fallback`, async ({ page }) => {
    const { requests, output } = await mount(page, command, { missingReadiness: true });
    await signInAndConfirm(page);
    await expect(page.getByRole("button", { name: "Prepare exact processing review (no model call)" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Load context — I authorize retrieval" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Get suggestions" })).toHaveCount(0);
    expect(requests).not.toContain("/api/review"); expect(output.count).toBe(0);
    await expect(page.getByText("model: not-configured", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).fixtureInserted)).toBeUndefined();
    await closeFixture(page);
  });
  test(`offline ${command}: cancellation discards a delayed successful fixture result`, async ({ page }) => {
    const { requests, releaseProcessing } = await mount(page, command, { deferProcessing: true });
    await requestProcessing(page, command);
    await expect(page.getByRole("status")).toContainText("Working privately");
    await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
    releaseProcessing();
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    expect(requests).toContain("/api/session/invalidate");
    await expect(page.getByText("Synthetic visible observation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select for outgoing preview" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Insert into Teams draft", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).fixtureInserted)).toBeUndefined();
    await closeFixture(page);
  });
}
test("offline explanation: model capability failure has no fake private result or retry", async ({ page }) => {
  const { output } = await mount(page, "explainVisual", { failures: { "/api/explain": "model-capability-unverified" } });
  await requestProcessing(page, "explainVisual");
  await expect(page.getByRole("status")).toContainText("model-capability-unverified");
  await expect(page.getByRole("heading", { name: "Possible meaning" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Insert into Teams draft", exact: true })).toHaveCount(0);
  expect(output.count).toBe(1);
  await closeFixture(page);
});
test("offline recommendation: rights pool shortfall never becomes three invented candidates", async ({ page }) => {
  const { output } = await mount(page, "recommendVisual", { failures: { "/api/review": "insufficient-candidates" } });
  await signInAndConfirm(page);
  await page.getByRole("button", { name: "Prepare exact processing review (no model call)" }).click();
  await expect(page.getByRole("status")).toContainText("insufficient-candidates");
  expect(output.count).toBe(0);
  await expect(page.getByRole("button", { name: "Select for outgoing preview" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "I consent — find three candidates" })).toHaveCount(0);
  await closeFixture(page);
});
test("offline recommendation: withdrawal blocks a new share review and removes an older preview", async ({ page }) => {
  const options: FixtureOptions = { failures: {} };
  await mount(page, "recommendVisual", options);
  await requestProcessing(page, "recommendVisual");
  await page.getByRole("button", { name: "Select for outgoing preview" }).first().click();
  await page.getByLabel("I confirm the original bound chat/channel and its full audience, not only my intended recipients.").check();
  await page.getByRole("button", { name: "Prepare exact outgoing preview" }).click();
  await expect(page.getByRole("region", { name: "Exact outgoing preview" })).toBeVisible();
  options.failures!["/api/share/prepare"] = "asset-rights-unavailable";
  await page.getByRole("button", { name: "Prepare exact outgoing preview" }).click();
  await expect(page.getByRole("status")).toContainText("asset-rights-unavailable");
  await expect(page.getByRole("region", { name: "Exact outgoing preview" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixtureInserted)).toBeUndefined();
  await closeFixture(page);
});
for (const language of ["en", "zh-CN"] as const) {
  test(`offline ${language}: long public notices and caption remain intact at 320px without clipping`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await mount(page, "recommendVisual", { wideNotices: true });
    await requestProcessing(page, "recommendVisual");
    await page.getByRole("button", { name: "Select for outgoing preview" }).first().click();
    await page.getByLabel("Optional public caption — can disclose private information").fill("X".repeat(500));
    await page.getByLabel("I confirm the original bound chat/channel and its full audience, not only my intended recipients.").check();
    await page.getByRole("button", { name: "Prepare exact outgoing preview" }).click();
    await page.getByLabel("UI language").selectOption(language);
    const preview = page.getByRole("region", { name: language === "en" ? "Exact outgoing preview" : "准确的对外预览" });
    await expect(preview).toBeVisible();
    for (const required of ["S".repeat(300), "C".repeat(300), "L".repeat(300), "义".repeat(500), "Mandatory fixture credit", "X".repeat(500)]) {
      await expect(preview).toContainText(required);
    }
    await expect(preview).not.toContainText("PRIVATE_FIXTURE_REASON");
    const link = preview.getByRole("link", { name: "Terms", exact: true });
    await expect(link).toHaveAttribute("href", `https://synthetic.example.test/terms/${"a".repeat(900)}`);
    await expect(link).toHaveAttribute("rel", "noreferrer noopener");
    const dimensions = await preview.evaluate(element => ({
      viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
      noticesUnclipped: [...element.querySelectorAll<HTMLElement>(".public-notices, .public-notices p")]
        .every(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1)
    }));
    expect(dimensions.noticesUnclipped).toBe(true);
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(await page.evaluate(() => (window as any).fixtureInserted)).toBeUndefined();
    await Promise.all([page.waitForResponse("**/api/session/close"),
      page.getByRole("button", { name: language === "en" ? "Reset / close session" : "重置 / 关闭会话" }).click()]);
  });
}
