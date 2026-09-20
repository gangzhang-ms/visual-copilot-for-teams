import {digest} from "./analysis-session";
import {boundedBody,type Transport} from "./graph-context";
import {normalizePublicImage,type MemeSnapshot} from "./internet-memes";
import {sniff} from "./media-normalizer";
import type {CatalogAsset} from "../catalog/visual-catalog";
import {WebImageSearchError,type WebImageSearchItem,type WebImageSearchProvider,type WebImageSearchQuery} from "./web-image-search";

export abstract class PublicSearchImages implements WebImageSearchProvider {
  abstract readonly id:"Brave"|"Wikimedia Commons"|"Google Images via SerpApi";
  abstract readonly configured:boolean;
  abstract search(query:Readonly<WebImageSearchQuery>,signal:AbortSignal):Promise<WebImageSearchItem[]>;
  abstract missingCode():string;
  protected abstract previewUrl(value:unknown):string;
  protected allowGif=false;
  readonly counters={searchRequests:0,previewRequests:0};
  private cache=new Map<string,{snapshot:MemeSnapshot;refs:number}>();
  protected constructor(protected transport:Transport=fetch){}
  get retainedBytes(){return [...this.cache.values()].reduce((n,e)=>n+e.snapshot.bytes,0);}
  async snapshot(item:WebImageSearchItem,query:string,caller:AbortSignal):Promise<MemeSnapshot>{
    const url=this.previewUrl(item.thumbnailUrl),key=digest(item.id+query),cached=this.cache.get(key);
    if(cached){cached.refs++;return cached.snapshot;}
    const signal=AbortSignal.any([caller,AbortSignal.timeout(20_000)]);
    if(signal.aborted)throw new WebImageSearchError("web-image-search-cancelled");
    this.counters.previewRequests++;
    const response=await this.transport(url,{method:"GET",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer",signal,
      headers:{Accept:this.allowGif?"image/png,image/jpeg,image/gif":"image/png,image/jpeg",
        ...(this.id==="Wikimedia Commons"?{"User-Agent":"VisualCopilotLocalDemo/0.1"}:{})}});
    if(!response.ok||response.redirected){await response.body?.cancel();throw new WebImageSearchError(response.status===429?"web-image-search-rate-limited":"web-image-search-unavailable");}
    const mime=(response.headers.get("content-type")??"").split(";")[0].trim();
    if(!["image/png","image/jpeg",...(this.allowGif?["image/gif"]:[])].includes(mime)){
      await response.body?.cancel();throw new WebImageSearchError("web-image-search-unsafe-result");
    }
    const bytes=await boundedBody(response,1024*1024,signal);
    if(sniff(bytes)!==mime)throw new WebImageSearchError("web-image-search-unsafe-result");
    const file=await normalizePublicImage(bytes,{allowGif:this.allowGif,preservePreview:this.id==="Google Images via SerpApi"},signal);
    if(signal.aborted)throw new WebImageSearchError("web-image-search-cancelled");
    const retained=bytes.length+file.preview.length+file.analysis.length;
    if(this.retainedBytes+retained>32*1024*1024)throw new WebImageSearchError("web-image-search-unavailable");
    const commons=this.id==="Wikimedia Commons",serp=this.id==="Google Images via SerpApi",a=item.attribution;
    if(commons&&!a)throw new WebImageSearchError("web-image-search-unsafe-result");
    const fetchedAt=Date.now(),version=digest(key+digest(file.preview)),noticeVersion=commons?"commons-preview-local-v1":    serp?"serpapi-preview-local-v2":"brave-web-preview-local-v1";
    const provenance=commons?"Wikimedia Commons thumbnail; per-file attribution retained, not corporate rights approval.":serp?"Google Images via SerpApi thumbnail; creator/license unverified. Not an official Google API.":"Brave-proxied web image preview; rights unverified.";
    const asset:CatalogAsset={public:{id:item.id,version,category:"image",alt:item.title,imageUrl:`/local/memes/${version}/${item.id}.png`,
      webSource:{kind:"web-image-preview",provider:this.id,title:item.title,pageUrl:item.sourcePageUrl,
        ...(item.imageUrl!==item.thumbnailUrl?{originalUrl:item.imageUrl}:{}),query,fetchedAt,...(a?{attribution:a}:{}),...(file.dimensions?{preview:file.dimensions}:{})},
      notices:{version:noticeVersion,source:`${this.id} image preview: ${item.title}`,creator:a?.artist??"Original creator/rights holder not verified.",
        license:a?.license??"Search visibility does not grant reuse or redistribution rights.",
        text:[commons?"Locally normalized Wikimedia thumbnail, not AI-generated. Caption is adjacent text; GIF uses the first frame. Check each file's license and other restrictions before sharing.":
          serp?"          Google/SerpApi-hosted Google Images thumbnail, not the full-resolution original. Not AI-redrawn; caption is adjacent text. Search visibility grants no rights.":"Brave-proxied preview, not the full-resolution original. Normalized locally, not AI-generated. Caption is adjacent text.",
          ...(a?[a.credit,a.attribution,a.restrictions].filter((s):s is string=>!!s):[]),
          `Preview download SHA-256: ${digest(bytes)}. Fetched ${new Date(fetchedAt).toISOString()}.`,
          commons?"Commons has no strict SafeSearch guarantee.":"SafeSearch is not a rights or content guarantee."],
        links:[{label:"Source page",url:item.sourcePageUrl},...(a?.licenseUrl?[{label:"License",url:a.licenseUrl}]:[]),
          ...(item.imageUrl!==item.thumbnailUrl?[{label:"Original image URL (not downloaded)",url:item.imageUrl}]:[])]}},
      tags:[item.title],safe:false,
      rights:{version:noticeVersion,approved:false,evidence:item.sourcePageUrl,validFrom:0,validUntil:0,withdrawn:false,publicHosting:false,redistribution:false,transformations:false,poster:false,downstreamRecallRequired:false},
      rendition:{version,digest:digest(file.preview),rightsVersion:noticeVersion,noticeVersion,verifiedAvailable:true,transformation:"derived"}};
    const snapshot:MemeSnapshot={version,fetchedAt,assets:[asset],bytes:retained,
      review:{digest:version,assets:[{visual:asset.public,provenance,hashes:[{file:item.id,sha256:digest(file.preview)},{file:`${item.id}-proxy`,sha256:digest(bytes)}]}]},
      read:id=>id===item.id?{...file,original:bytes}:undefined,
      release:()=>{const entry=this.cache.get(key);if(entry&&--entry.refs===0)this.cache.delete(key);},
      retain:()=>{const entry=this.cache.get(key);if(!entry)throw new WebImageSearchError("web-image-search-unavailable");
        entry.refs++;let done=false;return()=>{if(!done){done=true;snapshot.release();}};}};
    this.cache.set(key,{snapshot,refs:1});return snapshot;
  }
}
