import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {builtUrl} from "./build-root.mjs";
if(process.argv.slice(2).join(" ")!=="--live-once")throw new Error("Explicit --live-once is required; never part of CI.");
const dir=resolve(".local","visual-context","commons-source-smoke");await mkdir(dir,{recursive:true});
await writeFile(resolve(dir,"attempt.json"),JSON.stringify({startedAt:new Date().toISOString(),terms:"coffee cup"}),{flag:"wx"});
const {CommonsImageSearch}=await import(builtUrl("commons-image-search.js"));
const report={terms:"coffee cup",searchRequests:0,previewRequests:0,azureRequests:0,http:[],success:false};
const provider=new CommonsImageSearch(async(url,init)=>{
  const target=new URL(String(url));
  if(!["commons.wikimedia.org","upload.wikimedia.org"].includes(target.hostname))throw new Error("Unexpected host");
  const response=await fetch(url,init);
  report.http.push({host:target.hostname,status:response.status});return response;
});
let snapshot;
try{
  const items=await provider.search({terms:"coffee cup"},new AbortController().signal);
  if(!items.length)throw new Error("No usable licensed thumbnail returned");
  // Provider-only reachability smoke, not model relevance or a user candidate choice.
  snapshot=await provider.snapshot(items[0],"coffee cup",new AbortController().signal);
  const visual=snapshot.assets[0].public,files=snapshot.read(visual.id);
  await writeFile(resolve(dir,"download.bin"),files.original);
  await writeFile(resolve(dir,"preview.png"),files.preview);
  report.visual=visual;report.hashes=snapshot.review.assets[0].hashes;report.success=true;
}catch(error){
  report.error=error?.code??"source-smoke-failed";process.exitCode=1;
}finally{
  snapshot?.release();Object.assign(report,provider.counters,{recordedAt:new Date().toISOString(),retainedBytesAfterRelease:provider.retainedBytes});
  await writeFile(resolve(dir,"report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
