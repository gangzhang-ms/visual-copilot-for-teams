import { failureCodes, type FailureCode } from "../shared/types";
export class ApiError extends Error { constructor(readonly code: FailureCode) { super(code); } }
export class VisualApi {
  private capability = "";
  private abort = new AbortController();
  setCapability(value: string) { this.capability = value; }
  async call<T>(path: string, body: unknown = {}): Promise<T> {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(path === "/api/explain" || path === "/api/recommend" ? 46_000 : 30_000)]);
    const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", ...(this.capability ? { Authorization: `Bearer ${this.capability}` } : {}) }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok || value.status === "blocked" || value.status === "failed") throw new ApiError(failureCodes.includes(value.code) ? value.code : "not-configured");
    return value;
  }
  cancel() { this.abort.abort(); this.abort = new AbortController(); }
  async close() { this.cancel(); if (!this.capability) return; try { await this.call("/api/session/close"); } finally { this.capability = ""; } }
}
