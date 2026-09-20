import { expect, test } from "@playwright/test";

test("runtime actions make no outbound requests or persistent app state", async ({ page, context }) => {
  const runtimeRequests: string[] = [];
  let loaded = false;
  page.on("request", (request) => {
    if (loaded) runtimeRequests.push(request.url());
  });
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  await page.goto("/");
  loaded = true;
  const sentinel = "PRIVACY-SENTINEL-7f3a thanks for the help";
  await page.getByLabel("Paste or type context").fill(sentinel);
  await page.getByRole("button", { name: "Get suggestions" }).click();
  await page.getByRole("button", { name: /Thank you/ }).click();
  await page.getByRole("button", { name: "Reset" }).click();
  expect(runtimeRequests).toEqual([]);
  expect(consoleMessages.join(" ")).not.toContain(sentinel);
  expect(await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    databases: indexedDB.databases ? await indexedDB.databases() : []
  }))).toEqual({ local: [], session: [], databases: [] });
  expect(await context.cookies()).toEqual([]);
  await page.reload();
  await expect(page.getByLabel("Paste or type context")).toHaveValue("");
});
