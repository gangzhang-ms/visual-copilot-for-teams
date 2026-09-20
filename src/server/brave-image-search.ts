import {isIP} from "node:net";
import {digest} from "./analysis-session";
import {boundedBody,type Transport} from "./graph-context";
import {PublicSearchImages} from "./public-search-images";
import type {WebImageSearchItem,WebImageSearchQuery} from "./web-image-search";
import {WebImageSearchError} from "./web-image-search";
import {validWebSearchTerms} from "../shared/web-search-terms";

export const braveImageEndpoint="https://api.search.brave.com/res/v1/images/search";
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function requireSearch(ok:unknown,code:ConstructorParameters<typeof WebImageSearchError>[0]="web-image-search-invalid-response"):asserts ok{
  if(!ok)throw new WebImageSearchError(code);
}
function text(v:unknown,max:number){requireSearch(typeof v==="string"&&!!v.trim()&&v.length<=max&&!/[<>\u0000-\u001f\u007f]/u.test(v));return v;}
export function webSourceUrl(value:unknown){
  const raw=text(value,2048);requireSearch(!raw.includes("\\"));
  let url:URL;try{url=new URL(raw);}catch{throw new WebImageSearchError("web-image-search-invalid-response");}
  const hostname=url.hostname.replace(/\.$/,"");
  requireSearch(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password&&!isIP(hostname.replace(/^\[|\]$/g,""))
    &&hostname.includes(".")&&!/(^|\.)(localhost|local|internal)$/i.test(hostname));
  return url.href;
}
export function bravePreviewUrl(value:unknown){
  const raw=text(value,2048);let url:URL;try{url=new URL(raw);}catch{throw new WebImageSearchError("web-image-search-invalid-response");}
  requireSearch(raw.startsWith("https://imgs.search.brave.com/")&&!raw.includes("\\")
    &&url.protocol==="https:"&&url.hostname==="imgs.search.brave.com"&&!url.port&&!url.username&&!url.password&&!url.hash);
  return url.href;
}
export function parseBraveImages(value:unknown):WebImageSearchItem[]{
  requireSearch(record(value)&&value.type==="images"&&record(value.query)&&typeof value.query.original==="string"
    &&Array.isArray(value.results)&&value.results.length<=10);
  if(value.extra!==undefined){
    requireSearch(record(value.extra)&&typeof value.extra.might_be_offensive==="boolean");
    requireSearch(!value.extra.might_be_offensive,"web-image-search-unsafe-result");
  }
  const ids=new Set<string>(),items:WebImageSearchItem[]=[];
  for(const row of value.results){
    requireSearch(record(row)&&row.type==="image_result");
    if(row.title!==undefined)text(row.title,300);
    if(row.properties!==undefined)requireSearch(record(row.properties));
    const original=row.properties?.url;
    const imageUrl=original===undefined?undefined:webSourceUrl(original);
    // Missing usable preview/page is an explicit unusable result, not a fabricated URL.
    if(row.thumbnail===undefined||row.url===undefined)continue;
    requireSearch(record(row.thumbnail));
    if(row.thumbnail.src===undefined)continue;
    const thumbnailUrl=bravePreviewUrl(row.thumbnail.src),sourcePageUrl=webSourceUrl(row.url);
    const title=typeof row.title==="string"?row.title:"Untitled web image";
    const id=`web-${digest(JSON.stringify({thumbnailUrl,sourcePageUrl,title}))}`;
    if(ids.has(id))continue;ids.add(id);
    items.push({id,title,thumbnailUrl,imageUrl:imageUrl??thumbnailUrl,sourcePageUrl});
  }
  return items;
}

export class BraveImageSearch extends PublicSearchImages{
  readonly id="Brave";readonly configured:boolean;
  constructor(private key:string|undefined,transport:Transport=fetch,private credentialUnavailable=false){
    super(transport);
    this.configured=!!key?.trim()&&!credentialUnavailable;
  }
  protected previewUrl=bravePreviewUrl;
  async search(query:Readonly<WebImageSearchQuery>,caller:AbortSignal):Promise<WebImageSearchItem[]>{
    requireSearch(this.configured,"web-image-search-auth");
    requireSearch(validWebSearchTerms(query.terms),"web-image-search-invalid-query");
    const signal=AbortSignal.any([caller,AbortSignal.timeout(15_000)]);
    const url=new URL(braveImageEndpoint);
    url.search=new URLSearchParams({q:query.terms,count:"10",safesearch:"strict",country:"ALL",spellcheck:"false"}).toString();
    try{
      requireSearch(!signal.aborted,"web-image-search-cancelled");this.counters.searchRequests++;
      const response=await this.transport(url.href,{method:"GET",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer",signal,
        headers:{Accept:"application/json","X-Subscription-Token":this.key!}});
      if(!response.ok||response.redirected){
        await response.body?.cancel();
        throw new WebImageSearchError(response.status===401||response.status===403?"web-image-search-auth":response.status===429?"web-image-search-rate-limited":"web-image-search-unavailable");
      }
      if((response.headers.get("content-type")??"").split(";")[0].trim()!=="application/json"){await response.body?.cancel();throw new WebImageSearchError("web-image-search-invalid-response");}
      const bytes=await boundedBody(response,256*1024,signal);
      requireSearch(!signal.aborted,"web-image-search-cancelled");
      return parseBraveImages(JSON.parse(bytes.toString("utf8")));
    }catch(error){
      if(signal.aborted)throw new WebImageSearchError(caller.aborted?"web-image-search-cancelled":"web-image-search-unavailable");
      if(error instanceof WebImageSearchError)throw error;
      throw new WebImageSearchError("web-image-search-unavailable");
    }
  }
  missingCode(){return this.credentialUnavailable?"web-image-search-credential-unavailable":"web-image-search-not-configured";}
}
