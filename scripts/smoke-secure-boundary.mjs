const origin = process.env.APP_ORIGIN;
if (!origin) throw new Error("APP_ORIGIN is required.");
if (process.env.AUTHORIZE_BOUNDARY_SMOKE !== "true") throw new Error("Explicit AUTHORIZE_BOUNDARY_SMOKE=true is required; this runner performs remote reads.");
const paths = ["/", "/healthz", "/dialog", "/dialog-bootstrap.js", "/auth/start", "/api/messages", "/api/invocations/claim", "/api/readiness", "/api/context", "/api/share/prepare"];
for (const path of paths) {
  const response = await fetch(new URL(path, origin), { redirect: "manual" });
  console.log(`${path}: ${response.status}`);
}
console.log("This synthetic smoke is not H01-H04 proof; retain approved live platform evidence separately.");
