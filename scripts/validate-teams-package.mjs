import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "teams/build/manifest.json"), "utf8"));
for (const key of ["bots", "staticTabs", "configurableTabs", "permissions", "webApplicationInfo", "devicePermissions", "authorization"]) if (key in manifest) throw new Error(`Forbidden Teams manifest capability: ${key}`);
if (manifest.manifestVersion !== "1.30") throw new Error("Manifest 1.30 is required.");
const ext = manifest.composeExtensions;
if (ext?.length !== 1 || ext[0].commands?.length !== 2) throw new Error("Exactly two compose extension actions are required.");
for (const [index, id, context] of [[0, "explainVisual", "message"], [1, "recommendVisual", "compose,message"]]) {
  const command = ext[0].commands[index];
  if (command.id !== id || command.type !== "action" || command.fetchTask !== true || command.context?.join() !== context || command.parameters?.length) throw new Error("Action command contract mismatch.");
}
if (manifest.name.short !== "Visual Context" || manifest.name.full !== "Visual Context for Teams") throw new Error("Display branding mismatch.");
if (manifest.id === ext[0].botId) throw new Error("Teams App and Bot App IDs must be distinct.");
if (manifest.validDomains?.length !== 1 || manifest.validDomains[0].includes("*")) throw new Error("Exactly one non-wildcard valid domain is required.");
for (const url of [manifest.developer.websiteUrl, manifest.developer.privacyUrl, manifest.developer.termsOfUseUrl]) if (new URL(url).host !== manifest.validDomains[0]) throw new Error("Origin/domain mismatch.");
for (const [name, expected] of [["color.png", 192], ["outline.png", 32]]) {
  const png = await readFile(resolve(root, "teams/build", name));
  if (png.toString("hex", 1, 4) !== "504e47" || png.readUInt32BE(16) !== expected || png.readUInt32BE(20) !== expected) throw new Error(`${name} must be ${expected}x${expected}.`);
}
const zip = await readFile(resolve(root, "teams/build/emoji-copilot-teams.zip"));
for (const name of ["manifest.json", "color.png", "outline.png"]) if (!zip.includes(Buffer.from(name))) throw new Error(`ZIP missing ${name}`);
console.log("Message-extension Teams package validated; live Teams validation remains required.");
