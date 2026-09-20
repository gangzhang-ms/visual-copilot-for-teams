import {digest} from "./analysis-session";
import {boundedBody,type Transport} from "./graph-context";
import {PublicSearchImages} from "./public-search-images";
import {webSourceUrl} from "./brave-image-search";
import {WebImageSearchError,type WebImageSearchItem,type WebImageSearchQuery} from "./web-image-search";
import {validWebSearchTerms} from "../shared/web-search-terms";

export const serpApiEndpoint="https://serpapi.com/search";
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function requireSerp(ok:unknown):asserts ok{if(!ok)throw new WebImageSearchError("web-image-search-invalid-response");}
export function serpThumbnailUrl(value:unknown){
  requireSerp(typeof value==="string"&&value.length<=2048&&!/[\\\u0000-\u0020\u007f]/u.test(value));
  let url:URL;try{url=new URL(value);}catch{throw new WebImageSearchError("web-image-search-invalid-response");}
  if(/^https:\/\/encrypted-tbn[0-3]\.gstatic\.com(?::443)?\/images\?/.test(value)){
    requireSerp(url.protocol==="https:"&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname==="/images");
    const keys=[...url.searchParams.keys()],q=url.searchParams.get("q"),size=url.searchParams.get("s");
    requireSerp(keys.length>=1&&keys.length<=2&&new Set(keys).size===keys.length&&keys.every(k=>k==="q"||k==="s"));
    requireSerp(q!==null&&/^tbn:[A-Za-z0-9_-]{1,1536}={0,2}$/.test(q));
    requireSerp(size===null||size===""||(/^\d{1,4}$/.test(size)&&Number(size)<=4096));
    return url.href;
  }
  requireSerp(value.startsWith("https://serpapi.com/"));
  requireSerp(url.hostname==="serpapi.com"&&!url.port&&!url.username&&!url.password&&!url.hash&&!url.search
    &&/^\/searches\/[A-Za-z0-9_-]{1,128}\/images\/[A-Za-z0-9_-]{1,200}\.(?:jpe?g|png)$/.test(url.pathname));
  return url.href;
}
function sourceUrl(value:unknown){
  const url=new URL(webSourceUrl(value));
  requireSerp(![...url.searchParams.keys()].some(key=>/key|token|secret|authorization/i.test(key)));
  return url.href;
}
export function parseSerpImages(value:unknown,key?:string):WebImageSearchItem[]{
  requireSerp(record(value));
  if(value.error!==undefined)throw new WebImageSearchError("web-image-search-unavailable");
  if(value.search_metadata!==undefined){
    requireSerp(record(value.search_metadata));
    if(value.search_metadata.status!==undefined)requireSerp(value.search_metadata.status==="Success");
  }
  requireSerp(Array.isArray(value.images_results)&&value.images_results.length<=100);
  const items:WebImageSearchItem[]=[],seen=new Set<string>();
  for(const row of value.images_results){
    requireSerp(record(row));
    if(row.thumbnail===undefined||row.link===undefined)continue;
    requireSerp(typeof row.title==="string"&&!!row.title.trim()&&row.title.length<=300&&!/[<>\u0000-\u001f\u007f]/u.test(row.title));
    const thumbnailUrl=serpThumbnailUrl(row.thumbnail),sourcePageUrl=sourceUrl(row.link);
    const imageUrl=row.original===undefined?thumbnailUrl:sourceUrl(row.original);
    requireSerp(!key||![row.title,thumbnailUrl,sourcePageUrl,imageUrl].some(text=>text.includes(key)));
    const id=`web-${digest(JSON.stringify({thumbnailUrl,sourcePageUrl,title:row.title}))}`;
    if(seen.has(id))continue;seen.add(id);
    if(items.length<10)items.push({id,title:row.title,thumbnailUrl,sourcePageUrl,imageUrl});
  }
  return items;
}
export class SerpApiImageSearch extends PublicSearchImages{
  readonly id="Google Images via SerpApi";readonly configured:boolean;
  protected previewUrl=serpThumbnailUrl;
  constructor(private key:string|undefined,transport:Transport=fetch,private credentialUnavailable=false){
    super(transport);this.configured=!!key?.trim()&&!credentialUnavailable;
  }
  missingCode(){return this.credentialUnavailable?"web-image-search-credential-unavailable":"web-image-search-not-configured";}
  async search(query:Readonly<WebImageSearchQuery>,caller:AbortSignal):Promise<WebImageSearchItem[]>{
    if(!this.configured)throw new WebImageSearchError("web-image-search-auth");
    if(!validWebSearchTerms(query.terms))throw new WebImageSearchError("web-image-search-invalid-query");
    const signal=AbortSignal.any([caller,AbortSignal.timeout(20_000)]),url=new URL(serpApiEndpoint);
    url.search=new URLSearchParams({engine:"google_images",q:query.terms,api_key:this.key!,safe:"active",ijn:"0",output:"json"}).toString();
    try{
      if(signal.aborted)throw new WebImageSearchError("web-image-search-cancelled");
      this.counters.searchRequests++;
      const response=await this.transport(url.href,{method:"GET",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer",signal,headers:{Accept:"application/json"}});
      if(!response.ok||response.redirected){
        await response.body?.cancel();
        throw new WebImageSearchError([401,403].includes(response.status)?"web-image-search-auth":response.status===429?"web-image-search-rate-limited":"web-image-search-unavailable");
      }
      if((response.headers.get("content-type")??"").split(";")[0].trim()!=="application/json"){
        await response.body?.cancel();throw new WebImageSearchError("web-image-search-invalid-response");
      }
      const bytes=await boundedBody(response,512*1024,signal);
      return parseSerpImages(JSON.parse(bytes.toString("utf8")),this.key);
    }catch(error){
      if(signal.aborted)throw new WebImageSearchError(caller.aborted?"web-image-search-cancelled":"web-image-search-unavailable");
      if(error instanceof WebImageSearchError)throw error;
      // Transport errors can contain the credential-bearing URL. Never expose their message/cause.
      throw new WebImageSearchError("web-image-search-unavailable");
    }
  }
}
