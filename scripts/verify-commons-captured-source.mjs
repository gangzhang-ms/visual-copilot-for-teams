import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import sharp from "sharp";
import {builtUrl} from "./build-root.mjs";
const attempt=process.argv[2];
if(process.argv.length!==3||!["1","2"].includes(attempt))throw new Error("Only an explicitly authorized thumbnail attempt 1 or 2 is supported.");
const directory=resolve(".local","visual-context","commons-source-diagnosis");
await mkdir(directory,{recursive:true});
const {CommonsImageSearch,parseCommonsImages,commonsPreviewUrl}=await import(builtUrl("commons-image-search.js"));
const items=parseCommonsImages(JSON.parse(await readFile(resolve(directory,"response-1.bin"),"utf8")));
if(!items.length)throw new Error("Captured response contains no usable result");
const item=items[0];
await writeFile(resolve(directory,`thumbnail-attempt-${attempt}.json`),JSON.stringify({url:item.thumbnailUrl,startedAt:new Date().toISOString()}),{flag:"wx"});
const report={searchRequests:0,thumbnailRequests:0,azureRequests:0,success:false,item,http:[]};
const provider=new CommonsImageSearch(async(url,init)=>{
  if(++report.thumbnailRequests>1||String(url)!==commonsPreviewUrl(item.thumbnailUrl))throw new Error("Only the selected official thumbnail is authorized.");
  const response=await fetch(url,init);
  report.http.push({host:new URL(String(url)).hostname,status:response.status,contentType:response.headers.get("content-type"),retryAfter:response.headers.get("retry-after")});
  return response;
});
let snapshot;
try{
  snapshot=await provider.snapshot(item,"coffee cup",new AbortController().signal);
  const bytes=snapshot.read(item.id);
  await writeFile(resolve(directory,`download-${attempt}.bin`),bytes.original);
  await writeFile(resolve(directory,`preview-${attempt}.png`),bytes.preview);
  await writeFile(resolve(directory,`analysis-${attempt}.png`),bytes.analysis);
  const original=await sharp(bytes.original).metadata(),preview=await sharp(bytes.preview).metadata();
  Object.assign(report,{success:true,visual:snapshot.assets[0].public,hashes:snapshot.review.assets[0].hashes,
    downloaded:{bytes:bytes.original.length,format:original.format,width:original.width,height:original.height},
    preview:{bytes:bytes.preview.length,width:preview.width,height:preview.height}});
}catch(error){
  report.error=error?.code??"native-or-transport-failure";process.exitCode=1;
}finally{
  snapshot?.release();report.retainedBytesAfterRelease=provider.retainedBytes;report.recordedAt=new Date().toISOString();
  await writeFile(resolve(directory,`accepted-${attempt}.json`),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
