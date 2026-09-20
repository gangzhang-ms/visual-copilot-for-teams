import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";

const sourcePath=process.argv[2];
if(!sourcePath)throw new Error("Pass the explicitly supplied local PNG path.");
const source=await readFile(resolve(sourcePath));
const metadata=await sharp(source,{limitInputPixels:20_000_000}).metadata();
if(metadata.format!=="png"||(metadata.pages??1)!==1)throw new Error("Expected a single supplied PNG.");
const bytes=await sharp(source,{limitInputPixels:20_000_000})
  .resize({width:512,height:512,fit:"inside",withoutEnlargement:true}).png().toBuffer();
const output=await sharp(bytes).metadata();
if(bytes.length>1024*1024)throw new Error("Reference exceeds the existing upload bound.");
const sha=buffer=>createHash("sha256").update(buffer).digest("hex");
const manifest={version:1,origin:"User-provided film meme reference; underlying rights unverified; local demo only",
  redistribution:"No license or permission for publication is asserted. Check underlying rights before sharing.",
  assets:[{name:"film-reference.png",bytes:bytes.length,sha256:sha(bytes),sourceName:"User-provided first PNG reference",
    sourceSha256:sha(source),width:output.width,height:output.height,frames:1}]};
const root=resolve("assets","chat-demo");
await writeFile(resolve(root,"film-reference.png"),bytes);
await writeFile(resolve(root,"reference-manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify(manifest,null,2));
