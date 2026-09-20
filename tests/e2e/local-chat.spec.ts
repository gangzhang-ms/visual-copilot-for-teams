import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";
import type { createLocalChatServer as Factory } from "../../src/server/local-chat-server";

let app: Awaited<ReturnType<typeof Factory>>, origin: string;
let requests: any[], bad: boolean, hold: boolean;
test.beforeEach(async () => {
  requests = []; bad = false; hold = false;
  const buildRoot=process.env.VISUAL_BUILD_ROOT??"dist";
  const { createLocalChatServer }: { createLocalChatServer: typeof Factory } = await import(pathToFileURL(resolve(buildRoot, "server", "local-chat-server.js")).href);
  app = await createLocalChatServer("isolated-server-test-credential", { clientRoot:resolve(buildRoot,"client"),cooldownMs: 0, transport: async (_url, init) => {
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content[0].text); requests.push(input);
    if (hold) await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    const output = bad ? { invalid: true } : input.task === "rank"
      ? { candidates: input.catalog.slice(0, 3).map((a: any) => ({ id: a.id, reason: "Private fixture reason", caution: "Context is uncertain" })) }
      : { background:{source:null,context:null,frames:[]},observations: [{ text: "A red square is visible", frames: input.frames.map((f: any) => f.id) }],
        commonUsage: ["A possible signal"], contextualInterpretations: [{ text: "A possible reading", context: input.context.map((c: any) => c.label) }],
        uncertainties: ["Sender intent is unknown"], safeResponseGuidance: ["Ask for clarification"] };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }));
  } });
  origin = await app.start(0);
});
test.afterEach(async () => { await app.close(); });
async function open(page: Page) {
  await page.goto(origin + "/chat");
  await expect(page.getByRole("button",{name:"Start with fabricated text"})).toBeVisible();
  await expect(page.getByLabel("Language / 语言")).toHaveValue("en");
  await expect(page.getByRole("button", { name: "Start with fabricated text" })).toBeEnabled();
}
async function add(page: Page, image = false) {
  await page.getByLabel("Message", { exact: true }).fill("Only fabricated puzzle context");
  if (image) {
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "red" } }).png().toBuffer();
    await page.getByLabel("Attach visual").setInputFiles({ name: "owned-square.png", mimeType: "image/png", buffer: bytes });
    await expect(page.getByAltText("Attachment preview")).toBeVisible();
  }
  await page.getByRole("button", { name: "Add locally", exact: true }).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
}
async function reviewExplain(page: Page, image = false) {
  await add(page, image);
  await page.getByTestId("chat-message").getByRole("button", { name: "Explain", exact: true }).click();
  await page.getByLabel("Context 1", { exact: true }).fill("Edited fabricated context, reviewed by user");
  await page.getByRole("button", { name: "Preview model request", exact: true }).click();
  await expect(page.getByRole("region", { name: "Transmission preview" })).toBeVisible();
}
async function consent(page: Page) {
  await page.getByRole("checkbox", { name: "I own or may use this non-sensitive test content, and consent to this exact model request." }).check();
  await page.getByRole("button", { name: "Consent & run AI" }).click();
}
test("real local routes explain a normalized image only after reviewed consent", async ({ page }) => {
  await open(page); await reviewExplain(page, true);
  expect(app.counters.providerRequests).toBe(0);
  await expect(page.getByRole("button", { name: "Consent & run AI" })).toBeDisabled();
  await expect(page.getByAltText("Transmitted frame 0")).toBeVisible();
  await consent(page);
  await expect(page.locator(".explanation-background")).toContainText("cannot be identified confidently");
  await expect(page.getByText("A red square is visible", { exact: false })).not.toBeVisible();
  await page.locator(".explanation-details > summary").click();
  await expect(page.getByText("A red square is visible", { exact: false })).toBeVisible();
  expect(requests[0].context[0].text).toBe("Edited fabricated context, reviewed by user");
  expect(requests[0].frames).toHaveLength(1);
  expect(app.counters).toEqual({ providerRequests: 1, graphRequests: 0 });
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
});
test("actual local catalog attestation enables constrained ranking and exact manual insertion", async ({ page }) => {
  await open(page); await add(page);
  await page.getByRole("button", { name: "Express", exact: true }).click();
  await page.getByLabel("Intent or question", { exact: true }).fill("Offer calm support for a fictional puzzle");
  await expect(page.getByRole("button", { name: "Preview model request" })).toBeDisabled();
  expect(app.counters.providerRequests).toBe(0);
  await page.getByRole("button", { name: "Review assets", exact: true }).click();
  const library = page.getByRole("region", { name: "Local asset review" });
  await expect(library.locator("article")).toHaveCount(8);
  await library.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm local test use" }).click();
  await page.getByRole("button", { name: "Preview model request" }).click();
  expect(app.counters.providerRequests).toBe(0);
  await consent(page);
  await expect(page.locator(".local-candidate")).toHaveCount(3);
  expect(requests[0].catalog).toHaveLength(8);
  const caption = "A kind local response " + "长".repeat(478);
  await page.getByLabel("Optional local caption").fill(caption);
  await page.getByRole("button", { name: "Preview insertion", exact: true }).first().click();
  const preview = page.getByRole("region", { name: "Local insertion preview" });
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
  await preview.getByText("Source & local-use notices").click();
  await page.waitForTimeout(1100);
  await expect(preview.getByText("NOT APPROVED for public hosting or distribution; no license granted by this inventory")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Insert into local chat" }).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(2);
  const bubble = page.getByTestId("chat-message").last();
  await expect(bubble).toContainText(caption);
  await expect(bubble).not.toContainText("Private fixture reason");
  expect(app.counters).toEqual({ providerRequests: 1, graphRequests: 0 });
  await bubble.getByRole("button", { name: "Explain", exact: true }).click();
  await page.getByRole("button", { name: "Preview model request" }).click();
  await expect(page.getByAltText("Transmitted frame 0")).toBeVisible();
  expect(app.counters.providerRequests).toBe(1);
  await page.getByRole("button", { name: "Back to edit" }).click();
  await page.getByLabel("Intent or question", { exact: true }).fill("Private local intent to erase");
  await page.getByLabel("Avoid", { exact: true }).fill("Private local preference to erase");
  await page.getByRole("button", { name: "Clear room & revoke consent" }).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(0);
  await page.getByRole("button", { name: "Help me express", exact:true }).click();
  await expect(page.getByLabel("Intent or question", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Avoid", { exact: true })).toHaveValue("");
  await expect(page.getByText("Assets await your local-use permission review.")).toHaveCount(1);
});
test("GIF samples are reviewed without model dispatch and bad uploads fail locally", async ({ page }) => {
  await open(page);
  const pixels = Buffer.alloc(16 * 16 * 3 * 2, 0);
  pixels.fill(255, 0, 16 * 16 * 3);
  const gif = await sharp(pixels, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } }).gif({ delay: [100, 100], loop: 0 }).toBuffer();
  await page.getByLabel("Message", { exact: true }).fill("Original animated test");
  await page.getByLabel("Attach visual").setInputFiles({ name: "owned.gif", mimeType: "image/gif", buffer: gif });
  await expect(page.getByAltText("Attachment preview")).toBeVisible();
  await page.getByRole("button", { name: "Add locally" }).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
  await page.getByTestId("chat-message").getByRole("button", { name: "Explain", exact: true }).click();
  await page.getByRole("button", { name: "Preview model request" }).click();
  await expect(page.getByAltText(/^Transmitted frame/)).toHaveCount(2);
  await expect(page.getByText("GIF: sampled stills only. Motion and intervening content may be missed.")).toBeVisible();
  expect(app.counters.providerRequests).toBe(0);
  await page.getByRole("button", { name: "Back to edit" }).click();
  await page.getByLabel("Attach visual").setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(page.getByRole("alert")).toContainText("valid PNG");
  await expect(page.getByAltText("Attachment preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add locally" })).toBeDisabled();
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
  expect(app.counters.providerRequests).toBe(0);
});
test("review edits, cancellation, and malformed output never become success", async ({ page }) => {
  await open(page); await reviewExplain(page);
  await page.getByRole("button", { name: "Back to edit" }).click();
  await expect(page.getByRole("button", { name: "Consent & run AI" })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview model request" }).click();
  hold = true; await consent(page);
  await expect.poll(() => app.counters.providerRequests).toBe(1);
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("A red square is visible", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview model request" })).toBeEnabled();
  hold = false; bad = true;
  await page.getByRole("button", { name: "Preview model request" }).click();
  await consent(page);
  await expect(page.getByRole("alert")).toContainText("required explanation structure");
  await expect(page.getByTestId("chat-message")).toHaveCount(1);
});
test("origin, Host, CSRF and unknown paths cannot spend the key", async ({ request }) => {
  expect((await request.post(origin + "/local/session", { headers: { Origin: "https://unrelated.example", "Content-Type": "application/json" }, data: {} })).status()).toBe(400);
  expect((await request.get(origin + "/healthz", { headers: { Host: "unrelated.example" } })).status()).toBe(400);
  const response = await request.post(origin + "/local/session", { headers: { Origin: origin, "Content-Type": "application/json" }, data: {} });
  expect(response.status()).toBe(200);
  expect(response.headers()["set-cookie"]).toContain("HttpOnly; SameSite=Strict");
  expect((await request.post(origin + "/local/process", { headers: { Origin: origin, "Content-Type": "application/json" }, data: { consent: true } })).status()).toBe(400);
  expect((await request.get(origin + "/.local/visual-context/model-key.dpapi")).status()).toBe(400);
  expect(app.counters.providerRequests).toBe(0);
});
