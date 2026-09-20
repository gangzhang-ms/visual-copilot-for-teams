import { describe, expect, it } from "vitest";
import { parseSelectedMessage } from "./selected-message";
describe("selected message minimization", () => {
  it("extracts inert visible HTML and discards identity and resources", () => {
    const result = parseSelectedMessage({ body: { contentType: "html", content: '<p>Hello <at id="person">Alex</at><img src="https://evil/x"><script>steal()</script></p>' }, from: { id: "secret" }, id: "message", attachments: [{ contentType: "image/png", contentUrl: "https://evil" }] });
    expect(result).toEqual({ mode: "selected", context: "Hello Alex", attachmentNotice: "Selected visuals require authorized media access; unavailable assets are not analyzed." });
    expect(JSON.stringify(result)).not.toMatch(/secret|evil|message|steal/);
  });
  it.each([undefined, {}, { deleted: true, body: { contentType: "text", content: "x" } }, { body: { contentType: "text", content: "" } }, { body: { contentType: "markdown", content: "x" } }, { body: { contentType: "text", content: "x".repeat(65537) } }])("falls back to manual mode for unsupported payload", (payload) => expect(parseSelectedMessage(payload)).toEqual({ mode: "manual", context: "" }));
  it("accepts exactly 65,536 UTF-16 units", () => expect(parseSelectedMessage({ body: { contentType: "text", content: "x".repeat(65536) } }).mode).toBe("selected"));
  it("bounds attachment metadata at twenty without retaining records", () => expect(parseSelectedMessage({ body: { contentType: "text", content: "hello" }, attachments: Array.from({ length: 21 }, (_, index) => ({ contentUrl: `secret-${index}` })) })).toEqual({ mode: "selected", context: "hello", attachmentNotice: "Selected visuals require authorized media access; unavailable assets are not analyzed." }));
  it("retains image-only selection without authorizing its arbitrary URL", () => {
    const result = parseSelectedMessage({ body: { contentType: "html", content: '<img src="https://untrusted.test/private.png">' } });
    expect(result.mode).toBe("selected"); expect(result.context).toBe(""); expect(JSON.stringify(result)).not.toContain("untrusted");
  });
});
