import { expect, test } from "@playwright/test";

test("recommendation, preview, reset, and abstention journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/not stored, logged, sent to an external model/)).toBeVisible();
  await page.getByLabel("Paste or type context").fill("Thanks for staying late to fix the demo.");
  await page.getByRole("button", { name: "Get suggestions" }).click();
  await expect(page.getByText(/Recommended for appreciation context/).first()).toBeVisible();
  await page.getByRole("button", { name: /Thank you/ }).click();
  await expect(page.getByLabel("Copy/paste preview")).toHaveValue("🙏");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByLabel("Paste or type context")).toHaveValue("");
  await page.getByLabel("Paste or type context").fill("Okay…");
  await page.getByRole("button", { name: "Get suggestions" }).click();
  await expect(page.getByText(/No suitable emoji suggestion/)).toBeVisible();
});

test("input boundaries are enforced", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Get suggestions" }).click();
  await expect(page.getByText("Enter conversation context.")).toBeVisible();
  await page.getByLabel("Paste or type context").fill("a".repeat(2001));
  await page.getByRole("button", { name: "Get suggestions" }).click();
  await expect(page.getByText(/2,000 characters or fewer/)).toBeVisible();
});

test("100 warm deterministic interactions meet the standalone latency threshold", async ({ page }) => {
  await page.goto("/");
  const samples = await page.evaluate(async () => {
    const input = document.querySelector<HTMLTextAreaElement>("#context")!;
    const submit = document.querySelector<HTMLButtonElement>("button[type=submit]")!;
    const values: number[] = [];
    for (let index = 0; index < 110; index++) {
      const start = performance.now();
      const rendered = new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(input, index % 2 ? "Thanks for your help." : "Could you review this design?");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      submit.click();
      await rendered;
      if (index >= 10) values.push(performance.now() - start);
    }
    return values;
  });
  samples.sort((a, b) => a - b);
  expect(samples[94]).toBeLessThanOrEqual(100);
  expect(samples[99]).toBeLessThanOrEqual(250);
});
