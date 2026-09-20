import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {builtUrl} from "./build-root.mjs";
const attempt=process.argv[2];
if(process.argv.length!==3||!["1","2","3"].includes(attempt))throw new Error("Use one explicitly authorized capture number, 1 through 3.");
const directory=resolve(".local","visual-context","commons-source-diagnosis");
await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,`attempt-${attempt}.json`),JSON.stringify({terms:"coffee cup",startedAt:new Date().toISOString()}),{flag:"wx"});
const {CommonsImageSearch}=await import(builtUrl("commons-image-search.js"));
let calls=0;
const provider=new CommonsImageSearch(async(raw,init)=>{
  const url=new URL(String(raw));
  if(++calls>1||url.origin+url.pathname!=="https://commons.wikimedia.org/w/api.php")throw new Error("Only one fixed Commons API request is authorized per capture.");
  url.searchParams.set("gsrlimit","3");
  const response=await fetch(url,init);
  const receipt={url:url.href,status:response.status,contentType:response.headers.get("content-type"),retryAfter:response.headers.get("retry-after")};
  await writeFile(resolve(directory,`http-${attempt}.json`),JSON.stringify(receipt,null,2));
  const reader=response.body?.getReader(),chunks=[];let size=0;
  if(!reader)throw new Error("Missing response body");
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>256*1024)throw new Error("Response exceeds capture bound");
      chunks.push(Buffer.from(value));
    }
  }finally{await reader.cancel();reader.releaseLock();}
  const body=Buffer.concat(chunks);
  await writeFile(resolve(directory,`response-${attempt}.bin`),body);
  console.log(JSON.stringify({...receipt,bytes:body.length}));
  return new Response(body,{status:response.status,headers:response.headers});
});
try{
  const items=await provider.search({terms:"coffee cup"},new AbortController().signal);
  await writeFile(resolve(directory,`items-${attempt}.json`),JSON.stringify(items,null,2));
  console.log(JSON.stringify({usableItems:items.length,searchRequests:calls,thumbnailRequests:0,azureRequests:0}));
}catch(error){
  console.log(JSON.stringify({error:error?.code??"capture-failed",searchRequests:calls,thumbnailRequests:0,azureRequests:0}));
  process.exitCode=1;
}
