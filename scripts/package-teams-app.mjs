import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const testValues = process.argv.includes("--test-values");
const appId = testValues ? "11111111-1111-4111-8111-111111111111" : process.env.TEAMS_APP_ID;
const botId = testValues ? "22222222-2222-4222-8222-222222222222" : (process.env.BOT_APP_ID ?? process.env.CLIENT_ID);
const origin = testValues ? "https://emoji.example.test" : process.env.TEAMS_APP_ORIGIN;
if (!appId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appId)) throw new Error("TEAMS_APP_ID must be a valid GUID.");
if (!botId || botId === appId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(botId)) throw new Error("BOT_APP_ID must be a distinct valid GUID.");
let parsedOrigin;
try { parsedOrigin = new URL(origin); } catch { throw new Error("TEAMS_APP_ORIGIN must be an absolute HTTPS origin."); }
if (parsedOrigin.protocol !== "https:" || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) throw new Error("TEAMS_APP_ORIGIN must be a bare HTTPS origin.");

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "teams", "build");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const template = await readFile(resolve(root, "teams", "manifest.template.json"), "utf8");
const manifest = template
  .replaceAll("__TEAMS_APP_ID__", appId)
  .replaceAll("__BOT_APP_ID__", botId)
  .replaceAll("__TEAMS_APP_ORIGIN__", parsedOrigin.origin)
  .replaceAll("__TEAMS_APP_DOMAIN__", parsedOrigin.host);
await writeFile(resolve(output, "manifest.json"), manifest);
for (const icon of ["color.png", "outline.png"]) {
  await writeFile(resolve(output, icon), await readFile(resolve(root, "teams", icon)));
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data) => {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const localParts = [];
const centralParts = [];
let offset = 0;
for (const name of ["manifest.json", "color.png", "outline.png"]) {
  const data = await readFile(resolve(output, name));
  const filename = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(filename.length), u16(0), filename, data]);
  const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(filename.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), filename]);
  localParts.push(local); centralParts.push(central); offset += local.length;
}
const central = Buffer.concat(centralParts);
const archive = Buffer.concat([...localParts, central, u32(0x06054b50), u16(0), u16(0), u16(3), u16(3), u32(central.length), u32(offset), u16(0)]);
await writeFile(resolve(output, "emoji-copilot-teams.zip"), archive);
console.log(`Created ${resolve(output, "emoji-copilot-teams.zip")}`);
