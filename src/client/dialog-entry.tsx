import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VisualApp } from "./VisualApp";
import type { ClaimResponse } from "../shared/types";
import { createHostAdapter } from "../host/host-adapter";
import type { HostAdapter } from "../host/host-adapter";
import "./styles.css";
export async function start(takeToken: () => string | undefined) {
  try {
    await ensureStyles();
    const host = createHostAdapter(true);
    const snapshot = await host.initialize();
    document.documentElement.dataset.theme = snapshot.theme;
    host.onThemeChange((theme) => { document.documentElement.dataset.theme = theme; });
    const token = takeToken();
    if (!token) return fail();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3_000);
    const response = await fetch("/api/invocations/claim", { method: "POST", cache: "no-store", credentials: "same-origin", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    window.clearTimeout(timeout);
    if (!response.ok) return fail();
    const claim: unknown = await response.json();
    if (!isClaim(claim)) return fail();
    if (!claim.bootstrap || !claim.command || !claim.teamsAppId) return fail();
    renderDialog(claim, host);
  } catch { fail(); }
}
export function renderDialog(claim: ClaimResponse, host: HostAdapter) {
  createRoot(document.getElementById("root")!).render(<StrictMode><VisualApp claim={claim} host={host} /></StrictMode>);
}
function ensureStyles() {
  return new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "/assets/dialog.css";
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error("Styles unavailable")), { once: true });
    document.head.append(link);
  });
}
function isClaim(value: unknown): value is ClaimResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, any>;
  return v.schemaVersion === 1 && typeof v.invocationId === "string" && v.selected && ["manual", "selected"].includes(v.selected.mode) && typeof v.selected.context === "string" && v.selected.context.length <= 65_536 && (v.selected.attachmentNotice === undefined || typeof v.selected.attachmentNotice === "string");
}
function fail() {
  const root = document.getElementById("root");
  if (root) { root.textContent = "Visual Context is unavailable: unsupported host or expired link. Close and reopen in Teams."; root.setAttribute("role", "alert"); }
}
