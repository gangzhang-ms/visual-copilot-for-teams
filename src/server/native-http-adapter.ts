import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { HttpRouteHandler, IHttpServerAdapter } from "@microsoft/teams.apps";
import { dialogBootstrap, dialogCsp, dialogHtml } from "./dialog-bootstrap";
const headers = { "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache" };
const contentTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
export class NativeHttpAdapter implements IHttpServerAdapter {
  private readonly posts = new Map<string, HttpRouteHandler>();
  private readonly forms = new Map<string, HttpRouteHandler>();
  private readonly pages = new Map<string, () => string>();
  private catalogAsset?: (path: string) => Promise<{ bytes: Buffer; mime: string } | undefined>;
  private server?: Server;
  constructor(private readonly clientRoot = resolve("dist/client"), private readonly validateConnector?: (body: unknown, headers: Record<string, string | string[]>) => Promise<void>, private readonly serveHarness = false) {}
  get listeningPort() {
    const address = this.server?.address();
    return typeof address === "object" && address ? address.port : undefined;
  }
  registerRoute(method: "POST", path: string, handler: HttpRouteHandler) { if (method !== "POST") throw new Error("Unsupported method"); this.posts.set(path, handler); }
  registerForm(path: "/api/auth/callback", handler: HttpRouteHandler) { this.forms.set(path, handler); }
  registerPage(path: string, content: () => string) { this.pages.set(path, content); }
  registerCatalogAssets(handler: (path: string) => Promise<{ bytes: Buffer; mime: string } | undefined>) { this.catalogAsset = handler; }
  async start(port: number | string) {
    this.server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://local.invalid");
        if (url.search) return send(response, 400, "Bad request");
        if (request.method === "POST" && this.forms.has(url.pathname)) {
          if (request.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") throw new HttpStatusError(415);
          const raw = await readBody(request, 16_384);
          const params = new URLSearchParams(raw);
          if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new HttpStatusError(400);
          const result = await this.forms.get(url.pathname)!({ body: Object.fromEntries(params), headers: normalizeHeaders(request.headers) });
          return send(response, result.status, result.body, "text/html; charset=utf-8", { "Content-Security-Policy": popupCsp });
        }
        if (request.method === "GET" && this.pages.has(url.pathname)) return send(response, 200, this.pages.get(url.pathname)!(),
          url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", { "Content-Security-Policy": popupCsp });
        if (request.method === "POST" && this.posts.has(url.pathname)) {
          if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new HttpStatusError(415);
          const body = await readJson(request, url.pathname === "/api/media/normalize" ? 29 * 1024 * 1024 : 262_144);
          const normalized = normalizeHeaders(request.headers);
          if (url.pathname === "/api/messages" && this.validateConnector) await this.validateConnector(body, normalized);
          const result = await this.posts.get(url.pathname)!({ body, headers: normalized });
          return send(response, result.status, result.body, "application/json");
        }
        if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, "ok");
        if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/visuals/") && this.catalogAsset) {
          const asset = await this.catalogAsset(url.pathname); if (!asset) return send(response, 404, "Not found");
          return send(response, 200, request.method === "HEAD" ? "" : asset.bytes, asset.mime);
        }
        if (request.method === "GET" && url.pathname === "/dialog") return send(response, 200, dialogHtml, "text/html; charset=utf-8", { "Content-Security-Policy": dialogCsp });
        if (request.method === "GET" && url.pathname === "/dialog-bootstrap.js") return send(response, 200, dialogBootstrap, "text/javascript; charset=utf-8", { "Content-Security-Policy": dialogCsp });
        if (request.method !== "GET" && request.method !== "HEAD") return send(response, 404, "Not found");
        if (!url.pathname.startsWith("/assets/") && !(this.serveHarness && ["/", "/index.html"].includes(url.pathname))) return send(response, 404, "Not found");
        const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
        const path = resolve(this.clientRoot, relative);
        if (!(path === this.clientRoot || path.startsWith(this.clientRoot + sep))) return send(response, 404, "Not found");
        let info; try { info = await stat(path); } catch { throw new HttpStatusError(404); }
        if (!info.isFile()) throw new HttpStatusError(404);
        response.writeHead(200, { ...headers, "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream", "Content-Security-Policy": dialogCsp });
        if (request.method === "HEAD") return response.end();
        createReadStream(path).pipe(response);
      } catch (error) { send(response, error instanceof HttpStatusError ? error.status : 500, error instanceof HttpStatusError && error.status === 404 ? "Not found" : "Request rejected"); }
    });
    await new Promise<void>((resolveStart, reject) => { this.server!.once("error", reject); this.server!.listen(Number(port), "0.0.0.0", resolveStart); });
  }
  async stop() { if (this.server) await new Promise<void>((resolveStop, reject) => this.server!.close((error) => error ? reject(error) : resolveStop())); }
}
async function readBody(request: AsyncIterable<unknown>, limit: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const value = Buffer.from(chunk as any); size += value.length; if (size > limit) throw new HttpStatusError(413); chunks.push(value); }
  return Buffer.concat(chunks).toString("utf8");
}
async function readJson(request: AsyncIterable<unknown>, limit: number) {
  try { return JSON.parse(await readBody(request, limit)); } catch (error) { if (error instanceof HttpStatusError) throw error; throw new HttpStatusError(400); }
}
function normalizeHeaders(input: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined));
}
function send(response: any, status: number, body: unknown, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}) {
  const value = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body ?? {});
  response.writeHead(status, { ...headers, "Content-Type": type, ...extra }); response.end(value);
}
export class HttpStatusError extends Error { constructor(readonly status: number) { super("Request rejected"); } }
const popupCsp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
