import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App static contract", () => {
  it("renders privacy, language, accessible controls, and non-posting scope", () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain("Visual Copilot for Teams");
    expect(markup).toContain("Legacy Unicode-only sandbox");
    expect(markup).toContain("separately configured local chat prototype");
    expect(markup).toContain("English recommendations only");
    expect(markup).toContain("not stored, logged, sent to an external model");
    expect(markup).toContain('for="context"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("never posts, reacts, or injects text automatically");
  });
});
