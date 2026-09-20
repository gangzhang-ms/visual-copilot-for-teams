import { expect, test } from "@playwright/test";
import { dialogBootstrap, dialogCsp, dialogHtml } from "../../src/server/dialog-bootstrap";
const token = "A".repeat(43);
test("bootstrap scrubs before assets and unsupported host never claims private input", async ({ page }) => {
  const order: string[] = []; let claims = 0; let referrer = "";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => order.push(new URL(request.url()).pathname));
  await page.route("**/dialog", (route) => route.fulfill({ status: 200, contentType: "text/html", headers: { "Content-Security-Policy": dialogCsp, "Referrer-Policy": "no-referrer" }, body: dialogHtml }));
  await page.route("**/dialog-bootstrap.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: dialogBootstrap }));
  await page.route("**/api/invocations/claim", async (route) => {
    claims++; referrer = route.request().headers().referer ?? "";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, invocationId: "i", selected: { mode: "selected", context: "Thanks for your help." } }) });
  });
  await page.goto(`/dialog#token=${token}`);
  await expect(page.getByRole("alert"), errors.join(" | ")).toContainText("unsupported host");
  expect(new URL(page.url()).hash).toBe("");
  expect(claims).toBe(0);
  expect(referrer).not.toContain(token);
  expect(order.indexOf("/dialog-bootstrap.js")).toBeLessThan(order.indexOf("/assets/dialog-entry.js"));
  expect(order).not.toContain("/api/invocations/claim");
});
test("invalid fragments fail without loading or claiming", async ({ page }) => {
  let claims = 0;
  await page.route("**/dialog", (route) => route.fulfill({ status: 200, contentType: "text/html", headers: { "Content-Security-Policy": dialogCsp }, body: dialogHtml }));
  await page.route("**/dialog-bootstrap.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: dialogBootstrap }));
  await page.route("**/api/invocations/claim", (route) => { claims++; return route.abort(); });
  await page.goto("/dialog#token=short");
  await expect(page.getByRole("alert")).toContainText("invalid");
  expect(new URL(page.url()).hash).toBe("");
  expect(claims).toBe(0);
});
