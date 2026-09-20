import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { VisualApp } from "./VisualApp";
import { AudiencePreferences } from "./AudiencePreferences";
import { initialPreferences } from "./visual-i18n";
it("renders private gated workflow without inventing candidates or sending controls", () => {
  const markup = renderToStaticMarkup(<VisualApp claim={{ schemaVersion: 1, invocationId: "fixture", selected: { mode: "selected", context: "" }, command: "explainVisual", bootstrap: "synthetic" }}
    host={{ initialize: async () => ({ kind: "teams", theme: "default", showEnglishNotice: false }), onThemeChange: () => () => undefined, authenticate: async () => "", insert: () => undefined }} />);
  expect(markup).toContain("Visual Context for Teams");
  expect(markup).toContain("Pixels are not anonymized");
  expect(markup).toContain("Sign in with Teams popup");
  expect(markup).not.toContain("Insert into Teams draft");
  expect(markup).toContain("Load audience"); expect(markup).toContain("Load context"); expect(markup).toContain("I authorize retrieval");
});
it("localizes preferences to Simplified Chinese without deriving them from UI locale", () => {
  const value = initialPreferences();
  const markup = renderToStaticMarkup(<AudiencePreferences value={value} language="zh-CN" change={() => undefined} />);
  expect(markup).toContain("自愿提供的受众偏好"); expect(markup).toContain("移除偏好");
  expect(value.outputLanguage).toBe("en"); expect(value.confirmed).toBe(false);
});
