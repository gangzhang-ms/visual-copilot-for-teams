import {expect,it} from "vitest";
import {BraveImageSearch,braveImageEndpoint,bravePreviewUrl,parseBraveImages,webSourceUrl} from "./brave-image-search";
import {deriveWebSearchTerms,validWebSearchTerms} from "../shared/web-search-terms";
const data=()=>({type:"images",query:{original:"team relief"},results:[{type:"image_result",title:"Team reaction",
  url:"https://example.com/page",thumbnail:{src:"https://imgs.search.brave.com/test.jpg"},
  properties:{url:"https://example.com/original.jpg"}}],extra:{might_be_offensive:false}});
it("uses the official endpoint, strict SafeSearch and header-only credentials with minimal terms",async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const provider=new BraveImageSearch("OFFLINE-SEARCH-TOKEN",async(url,init)=>{
    calls.push({url:String(url),init});return new Response(JSON.stringify(data()),{headers:{"Content-Type":"application/json"}});
  });
  const result=await provider.search({terms:"team relief"},new AbortController().signal);
  const url=new URL(calls[0].url);expect(url.origin+url.pathname).toBe(braveImageEndpoint);
  expect(Object.fromEntries(url.searchParams)).toEqual({q:"team relief",count:"10",safesearch:"strict",country:"ALL",spellcheck:"false"});
  expect(calls[0].init).toMatchObject({method:"GET",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer",headers:{"X-Subscription-Token":"OFFLINE-SEARCH-TOKEN"}});
  expect(calls[0].url).not.toContain("TOKEN");expect(calls[0].init?.body).toBeUndefined();
  expect(result[0]).toMatchObject({title:"Team reaction",sourcePageUrl:"https://example.com/page",thumbnailUrl:"https://imgs.search.brave.com/test.jpg"});
});
it.each(["http://imgs.search.brave.com/a","https://imgs.search.brave.com.evil.com/a","https://user@imgs.search.brave.com/a",
  "https://imgs.search.brave.com:444/a","https://imgs.search.brave.com:443/a","https://imgs.search.brave.com/a#x",
  "https://127.0.0.1/a","https://imgs.search.brave.com./a","https://imgs.search.brave.com\\@evil.com/a","https://example.com/original.jpg"])("rejects unsafe/non-proxy preview URL %s",url=>{
    expect(()=>bravePreviewUrl(url)).toThrow();
});
it.each(["javascript:alert(1)","file:///a","http://169.254.169.254/latest","http://localhost./x","https://u:p@example.com/a"])("rejects unsafe source links %s",url=>expect(()=>webSourceUrl(url)).toThrow());
it("does not fabricate optional metadata; refuses unsafe flags and malformed fields",()=>{
  const noTitle=data();delete (noTitle.results[0] as {title?:string}).title;
  expect(parseBraveImages(noTitle)[0].title).toBe("Untitled web image");
  expect(parseBraveImages({...data(),results:[{type:"image_result"}]})).toEqual([]);
  for(const value of [{...data(),extra:{might_be_offensive:true}},{...data(),results:[{type:"image_result",url:"javascript:a",thumbnail:{src:"https://imgs.search.brave.com/a"}}]},
    {...data(),results:Array.from({length:11},()=>data().results[0])},{...data(),results:[{...data().results[0],title:33}]}])
    expect(()=>parseBraveImages(value)).toThrow();
});
it.each([401,403,429,302,500])("returns a bounded error without retry on HTTP%s",async status=>{
  let count=0;const provider=new BraveImageSearch("OFFLINE",async()=>{count++;return new Response("",{status});});
  await expect(provider.search({terms:"relief"},new AbortController().signal)).rejects.toThrow("web-image-search-");
  expect(count).toBe(1);
});
it("rejects oversized metadata and wrong MIME without logging or a fallback",async()=>{
  for(const response of [new Response("x".repeat(256*1024+1),{headers:{"Content-Type":"application/json"}}),new Response("<html>",{headers:{"Content-Type":"text/html"}})]){
    const provider=new BraveImageSearch("OFFLINE",async()=>response);
    await expect(provider.search({terms:"relief"},new AbortController().signal)).rejects.toThrow("web-image-search-");
  }
});
it("derives bounded visible terms only from intent, without URLs/emails or truncating the original intent",()=>{
  const intent="Please create a happy team reaction image https://private.example/path user@example.com";
  const before=intent,terms=deriveWebSearchTerms(intent);
  expect(terms).toBe("happy team reaction");expect(intent).toBe(before);expect(validWebSearchTerms(terms)).toBe(true);
  expect(validWebSearchTerms("https://private.example")).toBe(false);
  expect(validWebSearchTerms("person@example.com")).toBe(false);
  expect(deriveWebSearchTerms("请生成团队庆祝成功的图片")).not.toContain("图片");
  expect(deriveWebSearchTerms("word ".repeat(100)).length).toBeLessThanOrEqual(80);
});
