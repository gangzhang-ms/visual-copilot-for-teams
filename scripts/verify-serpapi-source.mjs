import {build} from "esbuild";
import {mkdir,copyFile,readdir,writeFile,open} from "node:fs/promises";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import sharp from "sharp";

const root=resolve(".local","visual-context","serpapi-source-acceptance");
const server=join(root,"server"),terms="relieved reaction movie meme";
const mode=process.argv[2];
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
async function prepare(){
  await mkdir(server,{recursive:true});
  const existing=resolve("dist-chat-google-create","server");
  for(const name of await readdir(existing)){
    if(name.endsWith(".js"))await copyFile(join(existing,name),join(server,name));
  }
  await build({entryPoints:["src/server/serpapi-image-search.ts"],outfile:join(server,"provider.mjs"),
    bundle:true,platform:"node",format:"esm",target:"node24",packages:"external",logLevel:"silent"});
}
async function bounded(response){
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  const chunks=[];let size=0;
  try{
    while(true){
      const part=await reader.read();if(part.done)break;
      size+=part.value.length;if(size>512*1024)throw new Error("bounded-response");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  }finally{await reader.cancel();reader.releaseLock();}
}
function publicCapture(value,key,thumbnailValidator){
  const text=v=>typeof v==="string"&&!v.includes(key)?v.slice(0,400):null;
  const url=v=>{
    if(typeof v!=="string"||v.length>4096||v.includes(key))return null;
    try{
      const u=new URL(v);
      if(!["https:","http:"].includes(u.protocol)||u.username||u.password||
          decodeURIComponent(u.href).includes(key))return null;
      return {url:u.origin+u.pathname,queryNames:[...u.searchParams.keys()].filter(n=>!n.includes(key)).slice(0,20)};
    }catch{return null;}
  };
  return {metadataStatus:text(value?.search_metadata?.status),errorPresent:value?.error!==undefined,
    resultsArray:Array.isArray(value?.images_results),
    resultCount:Array.isArray(value?.images_results)?value.images_results.length:null,
    images_results:Array.isArray(value?.images_results)?value.images_results.slice(0,100).map(row=>({
      title:text(row?.title),titleLength:typeof row?.title==="string"?row.title.length:null,
      thumbnail:{...url(row?.thumbnail),fullUrl:(()=>{
        try{return typeof row?.thumbnail==="string"&&!decodeURIComponent(row.thumbnail).includes(key)?thumbnailValidator(row.thumbnail):null;}
        catch{return null;}
      })()},link:url(row?.link),original:url(row?.original),
      originalWidth:Number.isSafeInteger(row?.original_width)?row.original_width:null,
      originalHeight:Number.isSafeInteger(row?.original_height)?row.original_height:null
    })):[]};
}
async function verify(offline){
  let key=offline?"OFFLINE-SYNTHETIC-KEY":process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;
  const repaired=mode==="--live-fixed-once";
  const directory=join(root,offline?"offline":repaired?"live-fixed":"live");
  await mkdir(directory,{recursive:true});
  const report={recordedAt:new Date().toISOString(),syntheticQuery:terms,offline,credentialLoaded:!!key,
    searchRequests:0,thumbnailRequests:0,azureRequests:0,searchHttpStatus:null,thumbnailHttpStatus:null,
    resultCount:0,passed:false};
  let provider,snapshot,selectedThumbnail;
  const started=performance.now();
  const safeCodes=new Set(["web-image-search-auth","web-image-search-rate-limited","web-image-search-unavailable",
    "web-image-search-invalid-response","web-image-search-unsafe-result","web-image-search-invalid-query",
    "web-image-search-cancelled","unsupported-format","decoder-budget-exceeded"]);
  try{
    if(!key)throw new Error("missing-credential");
    if(!offline){
      const marker=await open(join(directory,"attempt.json"),"wx");
      try{await marker.writeFile(JSON.stringify({recordedAt:report.recordedAt,query:terms,searchLimit:1,thumbnailLimit:1}));}
      finally{await marker.close();}
    }
    const {SerpApiImageSearch,serpThumbnailUrl}=await import(pathToFileURL(join(server,"provider.mjs")).href);
    const fixtureUrl="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9Gc_SYNTHETIC&s";
    const fixture=offline?await sharp({create:{width:32,height:24,channels:3,background:"#4477aa"}}).png().toBuffer():null;
    const transport=async(url,init)=>{
      const parsed=new URL(url);
      const search=parsed.origin==="https://serpapi.com"&&parsed.pathname==="/search";
      if(init?.redirect!=="error"||init?.credentials!=="omit")throw new Error("transport-boundary");
      if(search){
        if(++report.searchRequests!==1||parsed.searchParams.get("q")!==terms||
            parsed.searchParams.get("api_key")!==key||parsed.searchParams.get("engine")!=="google_images"||
            parsed.searchParams.get("safe")!=="active")throw new Error("search-boundary");
      }else{
        if(++report.thumbnailRequests!==1||url!==selectedThumbnail||serpThumbnailUrl(url)!==url||
            JSON.stringify(init?.headers??{}).includes(key)){
          throw new Error("thumbnail-boundary");
        }
      }
      const start=performance.now();
      const response=offline?(search?Response.json({search_metadata:{status:"Success",
        json_endpoint:`https://serpapi.com/search?api_key=${key}`},images_results:[
        {title:"Original geometric fixture",link:"https://example.com/fixture",thumbnail:fixtureUrl,original:fixtureUrl}
      ]}):new Response(fixture,{headers:{"content-type":"image/png"}})):await fetch(url,init);
      if(search){
        report.searchHttpStatus=response.status;
        report.searchContentType=(response.headers.get("content-type")??"").split(";")[0];
        const bytes=await bounded(response);
        report.searchLatencyMs=Math.round(performance.now()-start);
        try{
          const capture=publicCapture(JSON.parse(bytes.toString("utf8")),key,serpThumbnailUrl);
          report.upstreamResultCount=capture.resultCount;
          await writeFile(join(directory,"public-response.json"),JSON.stringify(capture,null,2));
        }catch{report.capture="non-json-or-capture-failed";}
        return new Response(bytes,{status:response.status,headers:{"content-type":report.searchContentType}});
      }
      report.thumbnailHttpStatus=response.status;
      report.thumbnailContentType=(response.headers.get("content-type")??"").split(";")[0];
      report.thumbnailHeadersLatencyMs=Math.round(performance.now()-start);
      return response;
    };
    provider=new SerpApiImageSearch(key,transport);
    const items=await provider.search({terms},new AbortController().signal);
    report.resultCount=items.length;
    const accepted=JSON.stringify(items,null,2);
    if(accepted.includes(key))throw new Error("accepted-metadata-boundary");
    await writeFile(join(directory,"accepted-items.json"),accepted);
    if(items.length===0){report.failureCode="no-results";return;}
    selectedThumbnail=items[0].thumbnailUrl;
    report.thumbnailHost=new URL(selectedThumbnail).hostname;
    snapshot=await provider.snapshot(items[0],terms,new AbortController().signal);
    const file=snapshot.read(items[0].id);
    if(!file?.original||!file.preview||!file.analysis)throw new Error("native-output");
    const provenance=JSON.stringify(snapshot.review,null,2);
    if(provenance.includes(key))throw new Error("provenance-boundary");
    await writeFile(join(directory,"provenance.json"),provenance);
    await writeFile(join(directory,"download.bin"),file.original);
    await writeFile(join(directory,"preview.png"),file.preview);
    await writeFile(join(directory,"analysis.png"),file.analysis);
    const png=Buffer.from([137,80,78,71,13,10,26,10]);
    if(!file.preview.subarray(0,8).equals(png))throw new Error("native-png");
    Object.assign(report,{passed:true,sourceTitle:items[0].title,
      sourcePage:items[0].sourcePageUrl,downloadBytes:file.original.length,downloadSha256:hash(file.original),
      previewBytes:file.preview.length,previewWidth:file.preview.readUInt32BE(16),previewHeight:file.preview.readUInt32BE(20),
      previewSha256:hash(file.preview),analysisBytes:file.analysis.length,
      provenance:"Google Images via SerpApi; creator/license unverified; not AI-generated"});
  }catch(error){
    report.failureCode=safeCodes.has(error?.code)?error.code:
      error?.code==="EEXIST"?"one-shot-already-consumed":"source-verification-failed";
  }finally{
    snapshot?.release();
    report.retainedBytesAfterRelease=provider?.retainedBytes??0;
    report.elapsedMs=Math.round(performance.now()-started);
    key=undefined;
    await writeFile(join(directory,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if(!report.passed)process.exitCode=1;
  }
}
try{
  if(mode==="--prepare"){await prepare();console.log("Isolated provider/native verification build prepared; no network.");}
  else if(mode==="--self-test")await verify(true);
  else if(mode==="--live-once"||mode==="--live-fixed-once")await verify(false);
  else throw new Error("mode");
}catch{console.error("Source verification stopped safely; no credential or raw transport error is logged.");process.exitCode=1;}
