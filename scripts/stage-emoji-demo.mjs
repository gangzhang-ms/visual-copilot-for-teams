import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
const root=resolve("assets","emoji-demo"),hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const names=["icon-01","icon-02","icon-03"];
const check=process.argv.includes("--check"),assets=[];
for(const name of names){
  const svg=await readFile(resolve(root,name+".svg"));
  assert(!/<(?:image|text|script|foreignObject)\b|\bhref\s*=|url\(\s*['"]?(?:https?:|data:)/i.test(svg.toString()));
  const bytes=await sharp(svg).png().toBuffer(),metadata=await sharp(bytes).metadata();
  assert.equal(metadata.width,384);assert.equal(metadata.height,384);assert(bytes.length<1024*1024);
  if(check)assert((await readFile(resolve(root,name+".png"))).equals(bytes));
  else await writeFile(resolve(root,name+".png"),bytes);
  assets.push({name:name+".png",source:name+".svg",sourceSha256:hash(svg),sha256:hash(bytes),bytes:bytes.length,width:384,height:384,frames:1});
}
const manifest={version:1,origin:"Original vector artwork authored locally for the emoji-understanding demo; no external assets or AI generation",
  generatorSha256:hash(await readFile(new URL(import.meta.url))),assets};
if(check)assert.deepEqual(JSON.parse(await readFile(resolve(root,"manifest.json"),"utf8")),manifest);
else await writeFile(resolve(root,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify({checked:check,assets:assets.map(({name,bytes,width,height})=>({name,bytes,width,height})),externalCalls:0}));
