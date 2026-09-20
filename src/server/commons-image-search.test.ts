import {describe,it,expect} from "vitest";
import {CommonsImageSearch,commonsEndpoint,commonsPreviewUrl,parseCommonsImages} from "./commons-image-search";
import {commonsPage,commonsResponse} from "./commons.test.support";
import capturedCoffee from "./fixtures/commons-imageinfo-coffee.json";
describe("Wikimedia Commons adapter",()=>{
  it("accepts the captured official response with slashless license and thumbnail CDN",()=>{
    const items=parseCommonsImages(capturedCoffee);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({title:"A small cup of coffee.JPG",attribution:{artist:"Julius Schorzman",license:"CC BY-SA 2.0",
      licenseUrl:"https://creativecommons.org/licenses/by-sa/2.0"}});
    expect(new URL(items[0].thumbnailUrl!).hostname).toBe("thumb.wikimedia.org");
  });
  it("honors the documented page-level badfile flag",()=>{
    const page={...commonsPage(),badfile:true};
    expect(parseCommonsImages({query:{pages:[page]}})).toEqual([]);
  });
  it("accepts only the exact official thumbnail CDN path",()=>{
    expect(commonsPreviewUrl("https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/X.jpg/512px-X.jpg")).toContain("thumb.wikimedia.org");
  });
  it.each(["https://thumb.wikimedia.org.evil.test/wikipedia/commons/thumb/x.jpg",
    "https://thumb.wikimedia.org:443/wikipedia/commons/thumb/x.jpg",
    "https://thumb.wikimedia.org/wikipedia/commons/x.jpg",
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/x.jpg#fragment"])("rejects invalid CDN URL %s",url=>{
    expect(()=>commonsPreviewUrl(url)).toThrow();
  });
  it("does not accept a different license version or a non-shareable license",()=>{
    const page=commonsPage();
    page.imageinfo[0].extmetadata.LicenseUrl.value="https://creativecommons.org/licenses/by-sa/2.0";
    expect(parseCommonsImages({query:{pages:[page]}})).toEqual([]);
    page.imageinfo[0].extmetadata.LicenseUrl.value="https://creativecommons.org/licenses/by-nd/4.0";
    expect(parseCommonsImages({query:{pages:[page]}})).toEqual([]);
  });
  it.each(["coffee cup","咖啡 杯子"])("uses official namespace6 search with minimal %s query and no key",async terms=>{
    const calls:{url:string;init?:RequestInit}[]=[];
    const provider=new CommonsImageSearch(async(url,init)=>{calls.push({url:String(url),init});return Response.json(commonsResponse());});
    expect(provider.configured).toBe(true);
    const results=await provider.search({terms},new AbortController().signal);
    expect(results).toHaveLength(3);expect(calls).toHaveLength(1);
    const url=new URL(calls[0].url);expect(url.origin+url.pathname).toBe(commonsEndpoint);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({gsrsearch:terms,generator:"search",gsrnamespace:"6",gsrlimit:"3",iiurlwidth:"512",formatversion:"2"});
    expect(calls[0].init).toMatchObject({method:"GET",redirect:"error",credentials:"omit",headers:{"User-Agent":"VisualCopilotLocalDemo/0.1"}});
    expect(JSON.stringify(calls)).not.toMatch(/Subscription|api.key|safesearch|PRIVATE/);
  });
  it("extracts inert per-file attribution and preserves canonical source links",()=>{
    const item=parseCommonsImages(commonsResponse())[1];
    expect(item.attribution).toEqual({artist:"Casey & Robin",license:"CC BY-SA 4.0",licenseUrl:"https://creativecommons.org/licenses/by-sa/4.0/",
      credit:"Own work",attribution:"Credit Casey & Robin",restrictions:"Check depicted subjects before sharing"});
    expect(item.sourcePageUrl).toBe("https://commons.wikimedia.org/wiki/File:Coffee_cup_1.jpg");
    expect(item.title).toBe("Coffee_cup_1.jpg");
  });
  it("never substitutes the uploader for the artist",()=>{
    const page=commonsPage();Object.assign(page.imageinfo[0],{user:"Uploader, not the creator"});
    expect(parseCommonsImages({query:{pages:[page]}})[0].attribution?.artist).toBe("Casey & Robin");
    page.imageinfo[0].extmetadata.Artist.value="";
    expect(parseCommonsImages({query:{pages:[page]}})).toEqual([]);
  });
  it("skips results without imageinfo without rejecting other usable files",()=>{
    const missing={pageid:90,ns:6,title:"File:Unavailable.jpg"};
    const empty={...missing,pageid:91,imageinfo:[]};
    expect(parseCommonsImages({query:{pages:[missing,empty,commonsPage()]}})).toHaveLength(1);
    expect(parseCommonsImages({query:{pages:[missing,empty]}})).toEqual([]);
  });
  it.each(["image/svg+xml","application/pdf","image/tiff","video/webm","audio/ogg"])("skips unsupported %s alongside usable images",mime=>{
    const page=commonsPage(9);page.imageinfo[0].mime=mime;
    expect(parseCommonsImages({query:{pages:[page,commonsPage()]}})).toHaveLength(1);
  });
  it("skips missing thumbnail, missing/restricted license, badfile and invalid dimensions per result",()=>{
    const rows=Array.from({length:6},(_,i)=>commonsPage(i));
    rows[0].imageinfo[0].thumburl="";
    rows[1].imageinfo[0].extmetadata.LicenseShortName.value="";
    rows[2].imageinfo[0].extmetadata.LicenseShortName.value="All rights reserved";
    Object.assign(rows[3].imageinfo[0],{badfile:true});rows[4].imageinfo[0].thumbwidth=9999;
    expect(parseCommonsImages({query:{pages:rows}}).map(i=>i.title)).toEqual(["Coffee_cup_5.jpg"]);
  });
  it("accepts declared public domain without inventing a license URL",()=>{
    const page=commonsPage();page.imageinfo[0].extmetadata.LicenseShortName.value="Public domain";
    page.imageinfo[0].extmetadata.LicenseUrl.value="";
    expect(parseCommonsImages({query:{pages:[page]}})[0].attribution).not.toHaveProperty("licenseUrl");
  });
  it.each(["image/png","image/gif"])("accepts metadata for supported %s preview",mime=>expect(parseCommonsImages({query:{pages:[commonsPage(0,mime)]}})).toHaveLength(1));
  it.each(["http://upload.wikimedia.org/wikipedia/commons/a/x.png","https://upload.wikimedia.org:443/wikipedia/commons/a/x.png",
    "https://upload.wikimedia.org./wikipedia/commons/a/x.png","https://upload.wikimedia.org.evil.test/wikipedia/commons/a/x.png",
    "https://upload.wikimedia.org/wikipedia/commons/x.png#fragment","https://user@upload.wikimedia.org/wikipedia/commons/x.png",
    "https://127.0.0.1/wikipedia/commons/x.png","https://upload.wikimedia.org\\@evil.test/wikipedia/commons/x.png"])("rejects unsafe preview %s",url=>expect(()=>commonsPreviewUrl(url)).toThrow());
  it("accepts encoded filenames on the exact upload host",()=>expect(commonsPreviewUrl("https://upload.wikimedia.org/wikipedia/commons/a/a1/Coffee%20cup.png")).toContain("Coffee%20cup"));
  it("normalizes path spaces and encoded File namespace without changing hosts",()=>{
    const page=commonsPage();page.imageinfo[0].descriptionurl="https://commons.wikimedia.org/wiki/File%3ACoffee%20cup.jpg";
    page.imageinfo[0].thumburl="https://upload.wikimedia.org/wikipedia/commons/a/a1/Coffee cup.jpg";
    const item=parseCommonsImages({query:{pages:[page]}})[0];
    expect(item.thumbnailUrl).toContain("Coffee%20cup.jpg");expect(item.sourcePageUrl).toContain("File%3A");
  });
  it("does not coerce malformed MIME arrays into supported images",()=>{
    const page=commonsPage();Object.assign(page.imageinfo[0],{mime:["image/jpeg"]});
    expect(parseCommonsImages({query:{pages:[page]}})).toEqual([]);
  });
  it("does not follow continuation, fabricate an empty hit or accept extra result count",()=>{
    expect(parseCommonsImages({batchcomplete:true})).toEqual([]);
    expect(parseCommonsImages({query:{pages:[]}})).toEqual([]);
    expect(()=>parseCommonsImages({query:{pages:Array.from({length:11},()=>commonsPage())}})).toThrow();
  });
  it.each([403,429,503])("fails explicitly without automatic retry for HTTP %s",async status=>{
    let requests=0;const provider=new CommonsImageSearch(async()=>{requests++;return new Response("",{status});});
    await expect(provider.search({terms:"coffee cup"},new AbortController().signal)).rejects.toMatchObject({code:status===429?"web-image-search-rate-limited":"web-image-search-unavailable"});
    expect(requests).toBe(1);
  });
  it("rejects API errors, HTML and oversized responses",async()=>{
    for(const response of [Response.json({error:{code:"maxlag",info:"Do not expose raw text"}}),
      new Response("<html>",{headers:{"Content-Type":"text/html"}}),
      new Response("x".repeat(256*1024+1),{headers:{"Content-Type":"application/json"}})]){
      const provider=new CommonsImageSearch(async()=>response);
      await expect(provider.search({terms:"coffee cup"},new AbortController().signal)).rejects.toThrow();
    }
  });
  it("reports only bounded public API codes, never body text or search terms",async()=>{
    const events:unknown[]=[];
    const provider=new CommonsImageSearch(async()=>Response.json({error:{code:"maxlag",info:"PRIVATE server detail"}}),event=>events.push(event));
    await expect(provider.search({terms:"coffee cup"},new AbortController().signal)).rejects.toThrow();
    expect(events).toEqual([{stage:"api",status:200,code:"maxlag"}]);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|coffee/);
  });
  it("pre-cancellation never starts transport",async()=>{
    let requests=0;const c=new AbortController();c.abort();const provider=new CommonsImageSearch(async()=>{requests++;return Response.json(commonsResponse());});
    await expect(provider.search({terms:"coffee cup"},c.signal)).rejects.toMatchObject({code:"web-image-search-cancelled"});expect(requests).toBe(0);
  });
});
