import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..", "assets", "visual-review", "v1");
const generatorPath = resolve(import.meta.dirname, "stage-visual-assets.mjs");
const filePath = file => resolve(root, ...file.split("\\"));
const hash = (bytes, encoding = "hex") => createHash("sha256").update(bytes).digest(encoding);
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const width = 320, height = 240, delay = 180;
const concepts = [
  { id: "steady-support", category: "image", title: "Steady support", alt: "A teal arch shelters a small gold circle above a firm horizontal base.", tags: ["support", "reassurance", "支持", "安心"], usage: "A restrained way to offer support; does not promise that a problem is resolved.", caution: "An abstract shelter may need a short caption.", color: "#168a83" },
  { id: "clear-acknowledgment", category: "sticker", title: "Clear acknowledgment", alt: "A navy outlined card contains a large teal check mark and two short neutral lines.", tags: ["acknowledge", "received", "确认", "收到"], usage: "Acknowledge receipt of a message without expressing celebration.", caution: "A check mark may imply completion; use a clarifying caption if only acknowledging receipt.", color: "#168a83" },
  { id: "thank-you-spark", category: "sticker", title: "Thank-you spark", alt: "Two rounded teal forms hold a small gold four-point spark between them.", tags: ["thanks", "appreciation", "感谢", "欣赏"], usage: "A gentle visual for appreciation.", caution: "Abstract symbolism is not universally understood; avoid claiming a cultural meaning.", color: "#168a83" },
  { id: "milestone-rise", category: "image", title: "Milestone rise", alt: "Three ascending teal blocks lead to a small gold flag, with sparse decorative rays.", tags: ["celebrate", "milestone", "progress", "庆祝", "进展"], usage: "Recognize a completed milestone or positive progress.", caution: "Celebratory imagery may be inappropriate during an unresolved incident.", color: "#168a83" },
  { id: "thinking-it-through", category: "image", title: "Thinking it through", alt: "Three blue outlined circles connect by a dotted path to an open gold ring.", tags: ["thinking", "review", "question", "思考", "审阅"], usage: "Signal consideration or a request for time to review.", caution: "The open ring is intentionally unresolved, not an assertion of an answer.", color: "#4c6db4" },
  { id: "take-a-pause", category: "sticker", title: "Take a pause", alt: "Two navy pause bars sit inside a teal outlined circle with a soft gold accent.", tags: ["pause", "break", "wait", "暂停", "稍等"], usage: "Ask for a pause or acknowledge the need for a break.", caution: "In urgent situations explain the intended next step in words.", color: "#168a83" },
  { id: "progress-steps", category: "gif", title: "Progress steps", alt: "Three teal stepping stones gently gain gold highlights in a short repeating sequence.", tags: ["progress", "working", "support", "进展", "处理中"], usage: "Show ongoing work without claiming completion.", caution: "The repeating sequence is decorative, not a real progress indicator.", color: "#168a83" },
  { id: "together-loop", category: "gif", title: "Together loop", alt: "Three blue and teal circles gently move toward a shared gold center and back.", tags: ["together", "collaboration", "support", "协作", "支持"], usage: "Acknowledge collaboration or shared effort.", caution: "Movement may distract; use the approved still poster in reduced-motion views.", color: "#4c6db4" }
];
function scene(id, frame = 0) {
  const ink = "#203349", teal = "#168a83", gold = "#d6a439";
  switch (id) {
    case "steady-support": return `<path d="M74 166V117a86 86 0 0 1 172 0v49" fill="none" stroke="${teal}" stroke-width="20" stroke-linecap="round"/><circle cx="160" cy="143" r="25" fill="${gold}"/><path d="M62 192h196" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>`;
    case "clear-acknowledgment": return `<rect x="68" y="45" width="184" height="150" rx="22" fill="white" stroke="${ink}" stroke-width="7"/><path d="m116 111 29 29 59-61" fill="none" stroke="${teal}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><path d="M114 165h92m-92 14h60" stroke="#adb8c4" stroke-width="5" stroke-linecap="round"/>`;
    case "thank-you-spark": return `<path d="M77 151c30 39 51 35 64 16l-6-40c-20-12-46-6-58 24m166 0c-30 39-51 35-64 16l6-40c20-12 46-6 58 24" fill="${teal}"/><path d="m160 48 13 32 34 13-34 13-13 34-13-34-34-13 34-13z" fill="${gold}"/>`;
    case "milestone-rise": return `<rect x="62" y="157" width="57" height="39" rx="6" fill="#88c7be"/><rect x="132" y="117" width="57" height="79" rx="6" fill="#48aa9d"/><rect x="202" y="77" width="57" height="119" rx="6" fill="${teal}"/><path d="M230 80V31" stroke="${ink}" stroke-width="5"/><path d="M232 31h37l-10 14 10 13h-37z" fill="${gold}"/><path d="m100 70-8-13m29 1 3-13m28 25 12-7" stroke="${gold}" stroke-width="5" stroke-linecap="round"/>`;
    case "thinking-it-through": return `<path d="M69 148q46-102 103-40t85 45" fill="none" stroke="#9aabc1" stroke-width="5" stroke-dasharray="5 10"/><g fill="white" stroke="#4c6db4" stroke-width="7"><circle cx="69" cy="148" r="20"/><circle cx="129" cy="89" r="20"/><circle cx="192" cy="122" r="20"/></g><path d="M275 172a25 25 0 1 1 3-37" fill="none" stroke="${gold}" stroke-width="9" stroke-linecap="round"/>`;
    case "take-a-pause": return `<circle cx="160" cy="120" r="76" fill="white" stroke="${teal}" stroke-width="10"/><rect x="129" y="80" width="22" height="80" rx="7" fill="${ink}"/><rect x="170" y="80" width="22" height="80" rx="7" fill="${ink}"/><circle cx="218" cy="61" r="14" fill="${gold}"/>`;
    case "progress-steps": return [0, 1, 2].map(i => `<rect x="${55 + i * 78}" y="${157 - i * 36}" width="56" height="${39 + i * 36}" rx="10" fill="${teal}"/><circle cx="${83 + i * 78}" cy="${141 - i * 36}" r="${frame % 3 === i ? 10 : 6}" fill="${frame % 3 === i ? gold : "#bdd9d2"}"/>`).join("");
    case "together-loop": {
      const distance = [68, 61, 54, 48, 54, 61][frame];
      return `<circle cx="160" cy="120" r="19" fill="${gold}"/>` + [0, 1, 2].map(i => {
        const angle = i * Math.PI * 2 / 3 - Math.PI / 2, x = Math.round(160 + distance * Math.cos(angle)), y = Math.round(120 + distance * Math.sin(angle));
        return `<path d="M160 120 ${x} ${y}" stroke="#c9d9e4" stroke-width="5"/><circle cx="${x}" cy="${y}" r="22" fill="${i === 0 ? teal : "#4c6db4"}"/>`;
      }).join("");
    }
    default: throw new Error("Unknown original concept");
  }
}
function svg(id, frame = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 320 240"><rect x="4" y="4" width="312" height="232" rx="26" fill="#f4f7fa" stroke="#dce5ed" stroke-width="3"/>${scene(id, frame)}</svg>`;
}
async function artifact(file, bytes, role, mime, derivedFrom = [], extra = {}) {
  await mkdir(dirname(filePath(file)), { recursive: true });
  await writeFile(filePath(file), bytes);
  return { file, role, mime, bytes: bytes.length, sha256: hash(bytes), sha256Base64url: hash(bytes, "base64url"), width, height, derivedFrom, ...extra };
}
async function verify() {
  const inventory = JSON.parse(await readFile(filePath("inventory.json"), "utf8"));
  assert.equal(inventory.status, "pending-owner-review");
  assert.equal(inventory.generator.sha256, hash(await readFile(generatorPath)));
  assert.equal(inventory.assets.length, 8);
  for (const asset of inventory.assets) {
    assert.equal(asset.rights.approved, false); assert.equal(asset.publicUrl, null);
    for (const file of asset.artifacts) {
      const bytes = await readFile(filePath(file.file));
      assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256);
      assert.equal(hash(bytes, "base64url"), file.sha256Base64url);
      if (file.mime === "image/svg+xml") assert.ok(!/<(?:image|text|script|foreignObject)\b|(?:href|url)\s*[=(]/i.test(bytes.toString()));
      else {
        const metadata = await sharp(bytes, { animated: true }).metadata();
        assert.equal(metadata.width, width); assert.equal(metadata.pageHeight ?? metadata.height, height);
        if (file.role === "original-animation") { assert.equal(metadata.pages, 6); assert.deepEqual(metadata.delay, Array(6).fill(delay)); }
      }
    }
  }
  for (const directory of [resolve(root, "..", "..", "..", "public", "visuals"), resolve(root, "..", "..", "..", "dist", "client", "visuals")]) {
    for (const asset of inventory.assets) {
      const name = `${asset.id}${asset.category === "gif" ? ".poster" : ""}.png`;
      assert.equal(await stat(resolve(directory, name)).then(() => true, () => false), false, "Pending asset was published");
    }
  }
  console.log("Verified eight pending original concepts, exact source/rendition hashes, two six-frame GIFs and non-public staging. No rights approval.");
}
if (process.argv.includes("--check")) {
  await verify();
} else {
  await mkdir(root, { recursive: true });
  const assets = [];
  for (const concept of concepts) {
    const artifacts = [];
    if (concept.category === "gif") {
      const rawFrames = [], sources = [];
      for (let i = 0; i < 6; i++) {
        const bytes = Buffer.from(svg(concept.id, i)), file = `${concept.id}\\frame-${i}.source.svg`;
        artifacts.push(await artifact(file, bytes, "source-frame", "image/svg+xml")); sources.push(file);
        rawFrames.push(await sharp(bytes).ensureAlpha().raw().toBuffer());
      }
      const animationFile = `${concept.id}.gif`;
      const animation = await sharp(Buffer.concat(rawFrames), { raw: { width, height: height * 6, pageHeight: height, channels: 4 } })
        .gif({ delay: Array(6).fill(delay), loop: 0, effort: 7, dither: 0 }).toBuffer();
      artifacts.push(await artifact(animationFile, animation, "original-animation", "image/gif", sources, { frames: 6, durationMs: 6 * delay }));
      const poster = await sharp(animation, { page: 0 }).png().toBuffer();
      artifacts.push(await artifact(`${concept.id}.poster.png`, poster, "poster", "image/png", [animationFile], { frameIndex: 0 }));
    } else {
      const source = Buffer.from(svg(concept.id)), sourceFile = `${concept.id}.source.svg`;
      artifacts.push(await artifact(sourceFile, source, "original-source", "image/svg+xml"));
      artifacts.push(await artifact(`${concept.id}.png`, await sharp(source).png().toBuffer(), "rendition", "image/png", [sourceFile]));
    }
    assets.push({
      ...concept, version: "pending-v1", contentReview: "pending", publicUrl: null, artifacts,
      provenance: { method: "New project-authored, AI-assisted geometric SVG instructions rasterized locally. No external reference images, stock art, fonts, logos, private data, or network requests.",
        source: "scripts\\stage-visual-assets.mjs", legalOwnership: "Undetermined until rights-owner review; project authorship is not a legal rights conclusion." },
      proposedNotices: { version: "draft-v1", source: "Visual Context geometric studies, revision 1", creator: "Project-created, AI-assisted artwork; final attribution requires owner confirmation",
        license: "NOT APPROVED for public hosting or distribution; no license granted by this inventory", text: ["Draft review asset. Public notice wording and permitted use require rights-owner approval."], links: [] },
      rights: { status: "pending", approved: false, evidence: null, publicHosting: false, redistribution: false, transformations: false, poster: false, validFrom: null, validUntil: null,
        downstreamRecallPolicy: "Owner must confirm terms compatible with native edits, recipient copies and caches; guaranteed recall is unavailable." }
    });
  }
  const inventory = { schemaVersion: 1, status: "pending-owner-review", productionEligible: false, generator: { file: "scripts\\stage-visual-assets.mjs", sha256: hash(await readFile(generatorPath)), sharpVersion: sharp.versions.sharp }, assets };
  await writeFile(filePath("inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
  const rows = assets.map(a => {
    const preview = a.artifacts.find(f => ["poster", "rendition"].includes(f.role));
    const original = a.artifacts.find(f => f.role === "original-animation");
    return `<article><h2>${escape(a.title)}</h2><img width="320" height="240" src="${preview.file}" alt="${escape(a.alt)}"><p>${escape(a.usage)}</p><p>Caution: ${escape(a.caution)}</p><p><strong>PENDING — NOT APPROVED FOR DISTRIBUTION</strong></p><p>Preview SHA-256: <code>${preview.sha256}</code></p>${original ? `<p><a href="${original.file}">Open original 1.08-second animation explicitly</a> (no autoplay in this review page)</p>` : ""}</article>`;
  }).join("");
  await writeFile(filePath("review.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Pending original visual asset review</title><style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:1rem;color:#203349;background:#fff}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:2rem}article{border:2px solid #dce5ed;padding:1rem}img{max-width:100%;height:auto}code{overflow-wrap:anywhere}a:focus{outline:3px solid #168a83}</style></head><body><h1>Pending original visual asset review</h1><p>Local, non-public review only. No copyright ownership, license, safety or public-hosting approval is asserted. Nothing in this directory is imported into the runtime catalog. Review exact hashes, originals, derived posters, attribution, terms and downstream-copy limits in inventory.json.</p><main>${rows}</main></body></html>\n`);
  await verify();
}
