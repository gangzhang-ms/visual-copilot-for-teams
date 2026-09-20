import assert from "node:assert/strict";
import { freemem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import sharp from "sharp";
import { builtUrl } from "./build-root.mjs";
const { generatedMedia }=await import(builtUrl("generated-media-host.js"));
const { generatedWorkerLease,generationLimits:limits }=await import(builtUrl("local-generation-config.js"));
const { normalizeMedia }=await import(builtUrl("media-normalizer.js"));
const { loadDevelopmentModelConfig }=await import(builtUrl("development-model.js"));
const hash=b=>createHash("sha256").update(b).digest("hex");
const startRss=process.memoryUsage().rss,headroom=freemem(),measurements=[];
assert(headroom>=512*1024*1024,"Insufficient shared-host headroom; native test stopped.");
globalThis.fetch=async()=>{throw new Error("Offline native test forbids network");};
process.env.GENERATION_PARENT_SENTINEL="synthetic-parent-only-value";
const geometric=await sharp(Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" fill="white"/><rect x="180" y="210" width="280" height="280" fill="#f77c73"/><circle cx="720" cy="680" r="180" fill="#456cc1"/></svg>')).png().toBuffer();
const signal=()=>new AbortController().signal;
async function measure(name,run) {
  assert(freemem()>=512*1024*1024,"Headroom stop.");
  const baseline=process.memoryUsage().rss,cpu=process.cpuUsage(),start=performance.now();let peak=baseline;
  const timer=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},5);
  try {return await run();} finally {
    clearInterval(timer);const after=process.memoryUsage().rss;peak=Math.max(peak,after);
    measurements.push({name,elapsedMs:Math.round(performance.now()-start),cpuMicros:process.cpuUsage(cpu),baselineRss:baseline,peakRss:peak,afterExitRss:after});
    assert(!generatedWorkerLease.busy,"Worker lease released only after actual teardown");
    assert(peak-startRss<384*1024*1024,"Conservative native-growth stop exceeded; do not increase limits");
  }
}
let still,gif;
for(let i=0;i<3;i++)await measure(`serial-geometric-${i+1}`,async()=>{
  const image=await generatedMedia("canonicalize",geometric,signal());
  assert(image.diagnostics.isolatedEnvironment);still=Buffer.from(image.image);
  const metadata=await sharp(still).metadata();assert.equal(metadata.width,512);assert.equal(metadata.height,512);assert(!metadata.exif&&!metadata.icc&&!metadata.xmp);
  assert(still.length<=limits.png);
  const animation=await generatedMedia("animate",still,signal());assert(animation.diagnostics.isolatedEnvironment);gif=Buffer.from(animation.animation);
  const m=await sharp(gif,{animated:true}).metadata();assert.equal(m.width,512);assert.equal(m.pageHeight,512);assert.equal(m.pages,12);assert.deepEqual(m.delay,Array(12).fill(100));assert.equal(m.loop,0);
  const raw=await sharp(gif,{animated:true}).ensureAlpha().raw().toBuffer();assert.equal(raw.length,limits.stacked);
  const hashes=Array.from({length:12},(_,n)=>hash(raw.subarray(n*512*512*4,(n+1)*512*512*4)));
  assert(new Set(hashes).size>=2);assert.equal(hashes[0],hashes[11]);assert(gif.length<=limits.gif);
});
await measure("actual-generated-explain-adaptation",async()=>{
  const config=loadDevelopmentModelConfig("fake-offline");
  for(const [bytes,animated] of [[still,false],[gif,true]]){
    const derivative=await generatedMedia("explain",bytes,signal(),animated);
    const media=await normalizeMedia([{id:"owned-generated-fixture",bytes:Buffer.from(derivative.derivative),mime:animated?"image/gif":"image/png",category:animated?"gif":"image"}],
      {...config.profile,imageCap:2,requestBytes:256*1024}, {...config.mediaLimits,maxFrames:60,maxPixels:4_000_000,maxDecodedBytes:16_000_000,timeoutMs:15_000,memoryMb:128},signal(),config.executionScope);
    assert.equal(media.samples.length,animated?2:1);assert(media.samples.every(s=>s.width===128&&s.height===128));
    assert(derivative.derivative.length+media.samples.reduce((n,s)=>n+s.bytes,0)<=limits.explain);
    if(animated)assert.deepEqual(media.samples.map(s=>s.timestampMs),[0,1100]);
  }
});
await measure("high-entropy-1024-source",async()=>{
  const raw=Buffer.alloc(1024*1024*4);let seed=1234567;
  for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=i%4===3?255:seed>>>24;}
  const noisy=await sharp(raw,{raw:{width:1024,height:1024,channels:4}}).png().toBuffer();assert(noisy.length<=limits.decoded);
  const result=await generatedMedia("canonicalize",noisy,signal());assert(result.image.length<=limits.png);
  let acceptedGif=false;try{await generatedMedia("animate",result.image,signal());acceptedGif=true;}catch(e){assert.match(e.message,/generation-media-rejected/);}
  measurements.push({name:"entropy-output",sourceBytes:noisy.length,canonicalPngBytes:result.image.length,acceptedGif});
});
await measure("invalid-shapes-flat-gif-and-abort",async()=>{
  for(const side of [1023,1025]){
    const bytes=await sharp({create:{width:side,height:side,channels:3,background:"white"}}).png().toBuffer();
    await assert.rejects(generatedMedia("canonicalize",bytes,signal()));
  }
  const flat=await sharp({create:{width:512,height:512,channels:3,background:"white"}}).png().toBuffer();
  await assert.rejects(generatedMedia("animate",flat,signal()));
  const controller=new AbortController(),start=performance.now(),pending=generatedMedia("animate",still,controller.signal);
  assert(generatedWorkerLease.busy);controller.abort();assert(generatedWorkerLease.busy,"Cancel cannot release before worker exit");
  await assert.rejects(generatedMedia("animate",still,signal()),/generation-busy/);
  await assert.rejects(pending,/generation-cancelled/);assert(!generatedWorkerLease.busy);
  measurements.push({name:"cancel-to-confirmed-exit",elapsedMs:performance.now()-start});
});
await measure("APNG-frame-count-delay-loop-and-byte-rejections",async()=>{
  const chunk=(type,data)=>{
    const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);
    let crc=0xffffffff;for(const byte of Buffer.concat([name,data])){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    checksum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,name,data,checksum]);
  };
  const idats=[];for(let at=8;at<geometric.length;){const size=geometric.readUInt32BE(at);if(geometric.subarray(at+4,at+8).toString()==="IDAT")idats.push(geometric.subarray(at+8,at+8+size));at+=size+12;}
  const ac=Buffer.alloc(8);ac.writeUInt32BE(2);
  const control=sequence=>{const value=Buffer.alloc(26);value.writeUInt32BE(sequence);value.writeUInt32BE(1024,4);value.writeUInt32BE(1024,8);value.writeUInt16BE(1,20);value.writeUInt16BE(10,22);return value;};
  const sequence=Buffer.alloc(4);sequence.writeUInt32BE(2);const compressed=Buffer.concat(idats);
  const apng=Buffer.concat([geometric.subarray(0,8),chunk("IHDR",geometric.subarray(16,29)),chunk("acTL",ac),chunk("fcTL",control(0)),chunk("IDAT",compressed),
    chunk("fcTL",control(1)),chunk("fdAT",Buffer.concat([sequence,compressed])),chunk("IEND",Buffer.alloc(0))]);
  await assert.rejects(generatedMedia("canonicalize",apng,signal()));
  const raw=await sharp(gif,{animated:true}).ensureAlpha().raw().toBuffer(),stride=512*512*4;
  for(const [count,delay,loop] of [[11,100,0],[13,100,0],[12,90,0],[12,110,0],[12,100,1]]){
    const data=count<=12?raw.subarray(0,count*stride):Buffer.concat([raw,raw.subarray(0,stride)]);
    const invalid=await sharp(data,{raw:{width:512,height:512*count,channels:4,pageHeight:512}})
      .gif({delay:Array(count).fill(delay),loop,keepDuplicateFrames:true,colours:128,effort:1,dither:0}).toBuffer();
    await assert.rejects(generatedMedia("explain",invalid,signal(),true));
  }
  await assert.rejects(generatedMedia("explain",Buffer.concat([gif,Buffer.alloc(limits.gif)]),signal(),true));
  // GIF delays are centiseconds: 99/101ms cannot be represented as exact file timings.
  measurements.push({name:"conjunctive-negative-vectors",rejected:["valid two-frame APNG","11 and 13 GIF frames","90 and 110ms GIF delays","nonzero GIF loop","GIF encoded one MiB overflow"]});
});
await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL(builtUrl("media-worker.js")),{env:{},workerData:{raw:Buffer.from([255,0,0,255]),width:1,height:1},resourceLimits:{maxOldGenerationSizeMb:128}});
  worker.once("error",reject);worker.once("message",async value=>{
    try{assert(value.ok&&value.isolatedEnvironment);await worker.terminate();resolve();}catch(error){reject(error);}
  });
});
delete process.env.GENERATION_PARENT_SENTINEL;
const report={evidence:"OFFLINE ORIGINAL FIXTURES ONLY; no live provider or risk acceptance",createdAt:new Date().toISOString(),imageProviderRequests:0,
  workerEnvironment:"empty; parent synthetic sentinel excluded in both worker types",headroomBytes:headroom,baselineRss:startRss,measurements,
  output:{stillBytes:still.length,gifBytes:gif.length,pngSha256:hash(still),gifSha256:hash(gif),width:512,frames:12,frameDelayMs:100,method:"local pan-zoom-v1"},
  limits,limitations:["RSS is whole test process including native worker allocations; sampled peak is not a hard native-memory cap.","No secure zeroization, provider entitlement, semantic acceptance, or live resource certification is claimed."]};
await mkdir(resolve(".local","visual-context"),{recursive:true});
await writeFile(resolve(".local","visual-context","generation-offline-report.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({imageProviderRequests:0,nativeCases:measurements.length,maximumSampledRss:Math.max(...measurements.map(m=>m.peakRss??0)),report:".local\\visual-context\\generation-offline-report.json"}));
