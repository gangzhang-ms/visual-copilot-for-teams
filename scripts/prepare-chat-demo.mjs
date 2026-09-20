import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {generatedMedia} from "../dist-chat-emoji-explain/server/generated-media-host.js";
import sharp from "sharp";
const source=resolve(".local","visual-context","expressive-validation"),target=resolve("assets","chat-demo");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const gardener=await readFile(resolve(source,"restrained-thanks.png")),owl=await readFile(resolve(source,"deadpan-relief.png"));
const animation=Buffer.from((await generatedMedia("animate",owl,new AbortController().signal)).animation);
const still=await sharp(gardener).resize(256,256).png().toBuffer();
const motion=Buffer.from((await generatedMedia("explain",animation,new AbortController().signal,true)).derivative);
const outputs=[["gardener.png",still,"restrained-thanks.png",gardener],["owl-motion.gif",motion,"deadpan-relief.png",owl]];
await mkdir(target,{recursive:true});
const assets=[];
for(const [name,bytes,sourceName,original] of outputs){
  const metadata=await sharp(bytes,{animated:true}).metadata();
  const side=name.endsWith(".gif")?128:256;
  if(bytes.length>1024*1024||metadata.width!==side||(metadata.pageHeight??metadata.height)!==side)throw new Error("Demo media exceeds upload contract");
  await writeFile(resolve(target,name),bytes);
  assets.push({name,bytes:bytes.length,sha256:hash(bytes),sourceName,sourceSha256:hash(original),width:metadata.width,height:metadata.pageHeight??metadata.height,frames:metadata.pages??1});
}
await writeFile(resolve(target,"manifest.json"),JSON.stringify({version:1,origin:"Original synthetic Azure gpt-image-1.5 validation on 2026-09-15; no new inference",animation:"pan-zoom-v1; local illustrative motion, not native video",assets},null,2)+"\n");
console.log(JSON.stringify(assets,null,2));
