import {parentPort,workerData} from "node:worker_threads";
import sharp from "sharp";

async function render(){
  sharp.cache(false);sharp.concurrency(1);
  const bytes=Buffer.from(workerData.bytes);
  if(bytes.length>1024*1024)throw new Error("unsupported-format");
  const image=sharp(bytes,{limitInputPixels:4_000_000,failOn:"warning"});
  const metadata=await image.metadata();
  const gif=workerData.allowGif===true&&metadata.format==="gif",pages=metadata.pages??1;
  if(!["png","jpeg"].includes(metadata.format??"")&&!gif||!gif&&pages!==1||gif&&(pages>60||pages<1)
    ||!metadata.width||!metadata.height||metadata.width>4096||metadata.height>4096
    ||gif&&metadata.width*metadata.height*pages>20_000_000
    ||workerData.width!==undefined&&metadata.width!==workerData.width
    ||workerData.height!==undefined&&metadata.height!==workerData.height)throw new Error("unsupported-format");
  const analysis=await image.clone().rotate().resize({width:128,height:128,fit:"inside",withoutEnlargement:true}).png().toBuffer();
  const maxSide=workerData.preservePreview===true?1024:512;
  let rendered=await image.clone().rotate().resize({width:maxSide,height:maxSide,fit:"inside",withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  if(rendered.data.length+analysis.length>1024*1024&&maxSide>512){
    rendered=await image.clone().rotate().resize({width:512,height:512,fit:"inside",withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  }
  if(rendered.data.length+analysis.length>1024*1024)throw new Error("decoder-budget-exceeded");
  const swapped=metadata.orientation!==undefined&&metadata.orientation>=5&&metadata.orientation<=8;
  return {preview:rendered.data,analysis,dimensions:{width:rendered.info.width,height:rendered.info.height,
    downloadWidth:swapped?metadata.height:metadata.width,downloadHeight:swapped?metadata.width:metadata.height}};
}
if(parentPort)void render().then(value=>parentPort!.postMessage({ok:true,...value}),
  ()=>parentPort!.postMessage({ok:false}));
