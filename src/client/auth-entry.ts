import { app, authentication } from "@microsoft/teams-js";
export async function start(bootstrap: string) {
  const root = document.getElementById("auth");
  try {
    await app.initialize();
    const completion = root?.dataset.completion;
    if (completion && /^[A-Za-z0-9_-]{43}$/.test(completion)) { authentication.notifySuccess(completion); return; }
    if (!/^[A-Za-z0-9_-]{43}$/.test(bootstrap)) throw new Error("auth-cancelled");
    const response = await fetch("/api/auth/start", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bootstrap }) });
    if (!response.ok) throw new Error("auth-required");
    const result = await response.json(), url = new URL(result.url);
    if (url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com") throw new Error("auth-required");
    window.location.assign(url.href);
  } catch { if (root) root.textContent = "Sign-in unavailable or cancelled. Close and reopen Visual Copilot for Teams."; authentication.notifyFailure("auth-required"); }
}
