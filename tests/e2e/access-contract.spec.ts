import { expect, test } from "@playwright/test";
test("standalone ranking sends no request and exposes no posting control", async ({ page }) => {
  const requests: string[] = [];
  await page.goto("/");
  page.on("request", (request) => requests.push(request.url()));
  await page.getByLabel("Paste or type context").fill("Could you review this design?");
  await page.getByRole("button", { name: "Get suggestions" }).click();
  await expect(page.getByText(/Recommended for attention context/).first()).toBeVisible();
  expect(requests).toEqual([]);
  await expect(page.getByRole("button", { name: /post|send|insert|react/i })).toHaveCount(0);
});
