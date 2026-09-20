import { parse } from "parse5";
import { describe, expect, it } from "vitest";
import { dialogBootstrap, dialogCsp, dialogHtml } from "./dialog-bootstrap";
describe("dialog bootstrap contract", () => {
  it("has exactly one initial executable and it is parser-blocking same-origin bootstrap", () => {
    const document = parse(dialogHtml) as any;
    const scripts: any[] = [];
    const walk = (node: any) => { if (node.nodeName === "script") scripts.push(node); node.childNodes?.forEach(walk); };
    walk(document);
    expect(scripts).toHaveLength(1);
    expect(Object.fromEntries(scripts[0].attrs.map((a: any) => [a.name, a.value]))).toEqual({ src: "/dialog-bootstrap.js" });
  });
  it("scrubs before identity checks/import/network APIs", () => {
    const scrub = dialogBootstrap.indexOf("history.replaceState");
    expect(scrub).toBeGreaterThan(0);
    for (const later of ["document.currentScript", 'import("/assets/dialog-entry.js")']) expect(dialogBootstrap.indexOf(later)).toBeGreaterThan(scrub);
    expect(dialogBootstrap.slice(0, scrub)).not.toMatch(/fetch|localStorage|sessionStorage|setTimeout|console/);
  });
  it("uses restrictive headers without inline execution", () => {
    expect(dialogCsp).toContain("default-src 'none'");
    expect(dialogCsp).not.toContain("unsafe-inline");
  });
});
