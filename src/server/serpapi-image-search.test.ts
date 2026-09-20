import {it,expect} from "vitest";
import {SerpApiImageSearch,parseSerpImages,serpThumbnailUrl} from "./serpapi-image-search";
import {serpResponse} from "./serpapi.test.support";
it.each([0,1,2,3])("accepts only exact Google thumbnail proxy %s",host=>{
  const url=`https://encrypted-tbn${host}.gstatic.com/images?q=tbn:ANd9Gc_PUBLIC-FIXTURE&s`;
  expect(serpThumbnailUrl(url)).toBe(url);
  expect(serpThumbnailUrl(url.replace(".com/",".com:443/"))).toBe(url);
});
it.each([
  "http://encrypted-tbn0.gstatic.com/images?q=tbn:abc",
  "https://encrypted-tbn4.gstatic.com/images?q=tbn:abc",
  "https://foo.gstatic.com/images?q=tbn:abc",
  "https://encrypted-tbn0.gstatic.com.evil.test/images?q=tbn:abc",
  "https://user@encrypted-tbn0.gstatic.com/images?q=tbn:abc",
  "https://encrypted-tbn0.gstatic.com:444/images?q=tbn:abc",
  "https://ENCRYPTED-TBN0.gstatic.com/images?q=tbn:abc",
  "https://encrypted-tbn0.xn--gstatic-9za.com/images?q=tbn:abc",
  "https://encrypted-tbn0.gstatic.com/%69mages?q=tbn:abc",
  "https://encrypted-tbn0.gstatic.com/x/../images?q=tbn:abc",
  "https://encrypted-tbn0.gstatic.com\\images?q=tbn:abc",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc&api_key=secret",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc&url=http://127.0.0.1",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc&q=tbn:def",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc&s=1&s=2",
  "https://encrypted-tbn0.gstatic.com/images?q=https://127.0.0.1",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc%0a",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc#fragment",
  `https://encrypted-tbn0.gstatic.com/images?q=tbn:${"a".repeat(1600)}`,
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc&s=999999"
])("rejects noncanonical or excessive Google thumbnail %s",url=>expect(()=>serpThumbnailUrl(url)).toThrow());
it("parses100 Google-hosted rows matching the captured response shape, without original downloads",()=>{
  const rows=Array.from({length:100},(_,i)=>({title:`Observed proxy shape ${i}`,
    thumbnail:`https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9Gc_fixture${i}&s`,
    link:`https://example.com/source${i}`,original:`https://original.example.com/image${i}.jpg`}));
  expect(parseSerpImages({search_metadata:{status:"Success"},images_results:rows})).toHaveLength(10);
  rows[99].thumbnail="https://arbitrary.example.com/image.jpg";
  expect(()=>parseSerpImages({images_results:rows})).toThrow();
});
it("sends the key only in the fixed official API query and excludes metadata endpoints from results",async()=>{
  const requests:{url:string;init?:RequestInit}[]=[];
  const provider=new SerpApiImageSearch("OFFLINE-SERP",async(url,init)=>{requests.push({url:String(url),init});return Response.json(serpResponse());});
  const items=await provider.search({terms:"relieved movie reaction"},new AbortController().signal);
  expect(requests).toHaveLength(1);const url=new URL(requests[0].url);
  expect(url.origin+url.pathname).toBe("https://serpapi.com/search");
  expect(Object.fromEntries(url.searchParams)).toEqual({engine:"google_images",q:"relieved movie reaction",api_key:"OFFLINE-SERP",safe:"active",ijn:"0",output:"json"});
  expect(requests[0].init).toMatchObject({redirect:"error",credentials:"omit",headers:{Accept:"application/json"}});
  expect(JSON.stringify(requests[0].init?.headers)).not.toContain("OFFLINE-SERP");
  expect(items).toHaveLength(3);expect(JSON.stringify(items)).not.toMatch(/OFFLINE-SERP|json_endpoint|original_width/);
  expect(items[0]).not.toHaveProperty("attribution");
});
it.each([undefined,""])("never attempts search without a key %s",async key=>{
  let calls=0;const provider=new SerpApiImageSearch(key,async()=>{calls++;return Response.json(serpResponse());});
  await expect(provider.search({terms:"coffee"},new AbortController().signal)).rejects.toMatchObject({code:"web-image-search-auth"});
  expect(calls).toBe(0);expect(provider.configured).toBe(false);
});
it.each([401,403,429,500])("classifies HTTP %s without exposing body/key",async status=>{
  const provider=new SerpApiImageSearch("OFFLINE-SERP",async()=>new Response("OFFLINE-SERP",{status}));
  await expect(provider.search({terms:"coffee"},new AbortController().signal)).rejects.toMatchObject({
    code:[401,403].includes(status)?"web-image-search-auth":status===429?"web-image-search-rate-limited":"web-image-search-unavailable"});
});
it("sanitizes transport errors containing the credential URL",async()=>{
  const provider=new SerpApiImageSearch("OFFLINE-SERP",async url=>{throw new Error(String(url));});
  await expect(provider.search({terms:"coffee"},new AbortController().signal)).rejects.toThrow("web-image-search-unavailable");
});
it("rejects HTTP200 provider errors and unexpected pending status without polling",()=>{
  expect(()=>parseSerpImages({error:"Secret-bearing error"})).toThrow("web-image-search-unavailable");
  expect(()=>parseSerpImages({...serpResponse(),search_metadata:{status:"Processing"}})).toThrow();
});
it.each(["http://serpapi.com/searches/a/images/a.jpeg","https://serpapi.com:443/searches/a/images/a.jpeg",
  "https://serpapi.com.evil.test/searches/a/images/a.jpeg","https://user@serpapi.com/searches/a/images/a.jpeg",
  "https://serpapi.com/search?api_key=secret","https://serpapi.com/searches/a/images/a.jpeg?api_key=secret",
  "https://serpapi.com/searches/a/images/a.svg","https://serpapi.com/searches/a/images/a.jpeg#fragment",
  "https://127.0.0.1/searches/a/images/a.jpeg"])("rejects unsafe thumbnail %s",url=>expect(()=>serpThumbnailUrl(url)).toThrow());
it("ignores unusable missing-media rows, caps selected metadata at10 and rejects oversized arrays",()=>{
  const data=serpResponse();data.images_results=Array.from({length:12},(_,i)=>({...data.images_results[0],title:`Title${i}`}));
  expect(parseSerpImages(data)).toHaveLength(10);
  expect(parseSerpImages({images_results:[{position:1}]})).toEqual([]);
  expect(()=>parseSerpImages({images_results:Array(101).fill({})})).toThrow();
});
it("does not treat original dimensions or an untrusted larger URL as trusted thumbnail quality",()=>{
  const data=serpResponse();
  const row={...data.images_results[0],original_width:99999,original_height:99999,
    thumbnail_width:4096,thumbnail_height:4096,large_thumbnail:"http://127.0.0.1/private"};
  const item=parseSerpImages({images_results:[row]})[0];
  expect(item.thumbnailUrl).toBe(row.thumbnail);
  expect(item).not.toHaveProperty("width");expect(item).not.toHaveProperty("preview");
  expect(JSON.stringify(item)).not.toContain("127.0.0.1");
});
it("rejects unsafe source links or key echoes instead of exposing them in notices",()=>{
  for(const link of ["http://127.0.0.1/private","javascript:alert(1)","https://example.com/?api_key=OFFLINE-SERP"]){
    const data=serpResponse();data.images_results[0].link=link;expect(()=>parseSerpImages(data,"OFFLINE-SERP")).toThrow();
  }
  const data=serpResponse();data.images_results[0].title="OFFLINE-SERP";expect(()=>parseSerpImages(data,"OFFLINE-SERP")).toThrow();
});
it("rejects HTML, oversized JSON and pre-cancellation without hidden retries",async()=>{
  for(const response of [new Response("<html>",{headers:{"Content-Type":"text/html"}}),new Response("x".repeat(512*1024+1),{headers:{"Content-Type":"application/json"}})]){
    const provider=new SerpApiImageSearch("OFFLINE",async()=>response);
    await expect(provider.search({terms:"coffee"},new AbortController().signal)).rejects.toThrow();
    expect(provider.counters.searchRequests).toBe(1);
  }
  const c=new AbortController();c.abort();const provider=new SerpApiImageSearch("OFFLINE",async()=>{throw new Error("must not run");});
  await expect(provider.search({terms:"coffee"},c.signal)).rejects.toThrow("web-image-search-cancelled");
  expect(provider.counters.searchRequests).toBe(0);
});
