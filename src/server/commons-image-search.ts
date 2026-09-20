import {digest} from "./analysis-session";
import {boundedBody,type Transport} from "./graph-context";
import {inertText} from "./selected-message";
import {PublicSearchImages} from "./public-search-images";
import {WebImageSearchError,type WebImageSearchItem,type WebImageSearchQuery} from "./web-image-search";
import {validWebSearchTerms} from "../shared/web-search-terms";
import type {ImageAttribution} from "../shared/types";

export const commonsEndpoint="https://commons.wikimedia.org/w/api.php";
export const commonsUserAgent="VisualCopilotLocalDemo/0.1";
export type CommonsDiagnostic={stage:"http"|"api"|"validation";status?:number;code:string};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function requireCommons(ok:unknown):asserts ok{if(!ok)throw new WebImageSearchError("web-image-search-invalid-response");}
function publicUrl(value:unknown,host:string,prefix:string){
  requireCommons(typeof value==="string"&&value.length<=2048&&value.startsWith(`https://${host}/`)&&!/[\\\u0000-\u001f\u007f]/u.test(value));
  let url:URL;try{url=new URL(value);}catch{throw new WebImageSearchError("web-image-search-invalid-response");}
  requireCommons(url.protocol==="https:"&&url.hostname===host&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname.startsWith(prefix));
  return url.href;
}
export const commonsPreviewUrl=(value:unknown)=>typeof value==="string"&&value.startsWith("https://thumb.wikimedia.org/")
  ?publicUrl(value,"thumb.wikimedia.org","/wikipedia/commons/thumb/")
  :publicUrl(value,"upload.wikimedia.org","/wikipedia/commons/");
function metadata(value:Record<string,unknown>,key:string,max=2000){
  if(value[key]===undefined)return undefined;
  const field=value[key];requireCommons(record(field)&&typeof field.value==="string"&&field.value.length<=8000);
  const text=inertText(field.value).replace(/\s+/gu," ").trim();
  requireCommons(text.length<=max&&!/[\u0000-\u001f\u007f]/u.test(text));
  return text||undefined;
}
function attribution(value:unknown):ImageAttribution|undefined{
  if(!record(value))return undefined;
  const artist=metadata(value,"Artist"),license=metadata(value,"LicenseShortName",100);
  if(!artist||!license)return undefined;
  const rawUrl=metadata(value,"LicenseUrl",400);
  let licenseUrl:string|undefined;
  if(rawUrl){
    // Commons metadata can use a protocol-relative Creative Commons license URL.
    const normalized=rawUrl.startsWith("//")?`https:${rawUrl}`:rawUrl.replace(/^http:\/\/creativecommons\.org\//,"https://creativecommons.org/");
    if(!normalized.startsWith("https://creativecommons.org/"))return undefined;
    licenseUrl=publicUrl(normalized,"creativecommons.org","/");
    const path=new URL(licenseUrl).pathname;
    const match=/^\/licenses\/(by|by-sa)\/(1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/(?:deed\.[a-z-]+)?)?$/.exec(path);
    const cc=match&&license.toUpperCase()===`CC ${match[1].toUpperCase()} ${match[2]}`;
    const pd=/^\/publicdomain\/(zero|mark)\/1\.0(?:\/(?:deed\.[a-z-]+)?)?$/.test(path)&&/^(CC0|Public domain)/i.test(license);
    if(!cc&&!pd)return undefined;
  }else if(license!=="Public domain")return undefined;
  return {artist,license,...(licenseUrl?{licenseUrl}:{}),
    credit:metadata(value,"Credit"),attribution:metadata(value,"Attribution"),restrictions:metadata(value,"Restrictions")};
}
export function parseCommonsImages(value:unknown):WebImageSearchItem[]{
  requireCommons(record(value)&&!value.error);
  if(value.query===undefined){requireCommons(value.batchcomplete===true);return [];}
  requireCommons(record(value.query)&&Array.isArray(value.query.pages)&&value.query.pages.length<=10);
  const items:WebImageSearchItem[]=[],seen=new Set<string>();
  for(const page of value.query.pages){
    requireCommons(record(page));
    if(page.missing||page.badfile!==undefined&&page.badfile!==false||page.ns!==6||!Array.isArray(page.imageinfo)||!page.imageinfo.length)continue;
    requireCommons(typeof page.title==="string"&&page.title.startsWith("File:")&&page.title.length<=300);
    const info=page.imageinfo[0];requireCommons(record(info));
    if(info.badfile!==undefined&&info.badfile!==false||typeof info.mime!=="string"||!["image/jpeg","image/png","image/gif"].includes(info.mime))continue;
    if(![info.width,info.height,info.size].every(n=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0))continue;
    // Originals are metadata only. Native bounds apply to the downloaded thumbnail.
    const thumbmime=info.thumbmime??info.mime,width=info.thumbwidth,height=info.thumbheight;
    if(!info.thumburl||typeof thumbmime!=="string"||!["image/jpeg","image/png","image/gif"].includes(thumbmime))continue;
    if(typeof width!=="number"||typeof height!=="number"||![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096)||width*height>4_000_000)continue;
    const a=attribution(info.extmetadata);if(!a)continue;
    const thumbnailUrl=commonsPreviewUrl(info.thumburl),imageUrl=publicUrl(info.url,"upload.wikimedia.org","/wikipedia/commons/");
    const sourcePageUrl=publicUrl(info.descriptionurl,"commons.wikimedia.org","/wiki/");
    let sourcePath:string;try{sourcePath=decodeURIComponent(new URL(sourcePageUrl).pathname);}catch{throw new WebImageSearchError("web-image-search-invalid-response");}
    requireCommons(sourcePath.startsWith("/wiki/File:"));
    const title=page.title.slice(5),id=`web-${digest(JSON.stringify({thumbnailUrl,sourcePageUrl,title,attribution:a}))}`;
    if(seen.has(id))continue;seen.add(id);
    items.push({id,title,imageUrl,thumbnailUrl,sourcePageUrl,attribution:a});
  }
  return items;
}
export class CommonsImageSearch extends PublicSearchImages{
  readonly id="Wikimedia Commons";readonly configured=true;
  protected allowGif=true;
  protected previewUrl=commonsPreviewUrl;
  constructor(transport:Transport=fetch,private diagnostic?:(event:CommonsDiagnostic)=>void){super(transport);}
  missingCode(){return "web-image-search-unavailable";}
  async search(query:Readonly<WebImageSearchQuery>,caller:AbortSignal):Promise<WebImageSearchItem[]>{
    if(!validWebSearchTerms(query.terms))throw new WebImageSearchError("web-image-search-invalid-query");
    const signal=AbortSignal.any([caller,AbortSignal.timeout(15_000)]),url=new URL(commonsEndpoint);
    url.search=new URLSearchParams({action:"query",format:"json",formatversion:"2",generator:"search",gsrsearch:query.terms,
      gsrnamespace:"6",gsrlimit:"3",prop:"imageinfo",iiprop:"url|size|mime|thumbmime|extmetadata|badfile",iiurlwidth:"512",
      iiurlheight:"512",iiextmetadatafilter:"Artist|LicenseShortName|LicenseUrl|Attribution|Credit|Restrictions",maxlag:"5"}).toString();
    try{
      if(signal.aborted)throw new WebImageSearchError("web-image-search-cancelled");
      this.counters.searchRequests++;
      const response=await this.transport(url.href,{method:"GET",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer",signal,
        headers:{Accept:"application/json","User-Agent":commonsUserAgent}});
      if(!response.ok||response.redirected){
        this.diagnostic?.({stage:"http",status:response.status,code:response.status===429?"rate-limited":"unavailable"});
        await response.body?.cancel();
        throw new WebImageSearchError(response.status===429?"web-image-search-rate-limited":"web-image-search-unavailable");
      }
      if((response.headers.get("content-type")??"").split(";")[0].trim()!=="application/json"){
        await response.body?.cancel();throw new WebImageSearchError("web-image-search-invalid-response");
      }
      const bytes=await boundedBody(response,256*1024,signal);
      const value:unknown=JSON.parse(bytes.toString("utf8"));
      if(record(value)&&value.error){
        const code=record(value.error)&&typeof value.error.code==="string"&&["maxlag","ratelimited","badvalue","permissiondenied","readapidenied"].includes(value.error.code)?value.error.code:"other";
        this.diagnostic?.({stage:"api",status:response.status,code});
        throw new WebImageSearchError(code==="ratelimited"?"web-image-search-rate-limited":"web-image-search-unavailable");
      }
      return parseCommonsImages(value);
    }catch(error){
      if(signal.aborted)throw new WebImageSearchError(caller.aborted?"web-image-search-cancelled":"web-image-search-unavailable");
      if(error instanceof WebImageSearchError){
        if(error.code==="web-image-search-invalid-response")this.diagnostic?.({stage:"validation",code:error.code});
        throw error;
      }
      throw new WebImageSearchError("web-image-search-unavailable");
    }
  }
}
