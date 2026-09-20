import {describe,it,expect} from "vitest";
import {InternetMemes,memeEndpoint,parseTemplates,selectExistingTemplate} from "./internet-memes";
import {eligible} from "./visual-retrieval";
import {loadLocalCatalog} from "./local-catalog";

const payload=()=>({success:true,data:{memes:Array.from({length:6},(_,i)=>({id:String(100+i),name:`Fixture ${i}`,
  url:`https://i.imgflip.com/a${i}.png`,width:64,height:64,box_count:2}))}});
describe("public meme metadata boundary",()=>{
  it("prefers a relevant photographic pattern over a cartoon match without inventing an unmatched source",()=>{
    const data=payload();
    data.data.memes[0]={...data.data.memes[0],id:"87743020",name:"Two Buttons"};
    data.data.memes[5]={...data.data.memes[5],id:"181913649",name:"Drake Hotline Bling"};
    for(const intent of ["two choices and a dilemma","在两个选择中纠结"])
      expect(selectExistingTemplate(parseTemplates(data),intent)?.template.name).toBe("Drake Hotline Bling");
    for(const intent of ["a spectacular nebula","context and captionable familiarity"])
      expect(selectExistingTemplate(parseTemplates(payload()),intent)).toBeUndefined();
    data.data.memes[5].name="Not the expected template";
    expect(selectExistingTemplate(parseTemplates(data),"two choices")?.photographic).toBe(false);
  });
  it("matches gratitude bilingually and does not make an image request for an unmatched intent",async()=>{
    const data=payload();data.data.memes[5]={...data.data.memes[5],id:"135256802",name:"Epic Handshake"};
    for(const intent of ["Thanks for the teamwork","谢谢团队帮忙"])
      expect(selectExistingTemplate(parseTemplates(data),intent)?.template.name).toBe("Epic Handshake");
    const provider=new InternetMemes(async()=>new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}}));
    expect(await provider.search("an astronomical nebula",new AbortController().signal)).toMatchObject({code:"generation-source-no-match",inspiration:{references:[]}});
    expect(provider.counters).toEqual({metadataRequests:1,imageRequests:0});
  });
  it("accepts a bounded fixed-host template list",()=>expect(parseTemplates(payload())).toHaveLength(6));
  for(const url of ["http://i.imgflip.com/a.png","https://i.imgflip.com.evil.test/a.png","https://i.imgflip.com@evil.test/a.png",
    "https://i.imgflip.com/a.png?text=private","https://i.imgflip.com/a.png#x","https://i.imgflip.com:443/a.png",
    "https://i.imgflip.com/../a.png","https://i.imgflip.com/a.gif","file:///a.png"]){
    it(`rejects noncanonical image URL ${url}`,()=>{
      const data=payload();data.data.memes[0].url=url;expect(()=>parseTemplates(data)).toThrow("meme-source-invalid");
    });
  }
  it("rejects duplicate IDs, oversized dimensions, bad counts and untrusted markup",()=>{
    for(const edit of [(v:ReturnType<typeof payload>)=>{v.data.memes[0].id=v.data.memes[1].id;},
      (v:ReturnType<typeof payload>)=>{v.data.memes[0].width=5000;},
      (v:ReturnType<typeof payload>)=>{v.data.memes[0].height=NaN;},
      (v:ReturnType<typeof payload>)=>{v.data.memes[0].name="<script>";},
      (v:ReturnType<typeof payload>)=>{v.data.memes.length=5;}]){
      const data=payload();edit(data);expect(()=>parseTemplates(data)).toThrow("meme-source-invalid");
    }
  });
  it("never follows redirect responses or carries request content/credentials",async()=>{
    const requests:{url:string;init?:RequestInit}[]=[];
    const provider=new InternetMemes(async(url,init)=>{requests.push({url:String(url),init});return new Response("",{status:302,headers:{Location:"https://evil.test"}});});
    await expect(provider.load(new AbortController().signal)).rejects.toThrow("meme-source-unavailable");
    expect(requests).toEqual([{url:memeEndpoint,init:expect.objectContaining({method:"GET",redirect:"error",credentials:"omit",headers:{Accept:"application/json"}})}]);
    expect(requests[0].init?.body).toBeUndefined();expect(provider.retainedBytes).toBe(0);
  });
  it("rejects oversized streams and wrong MIME without a cache or fallback",async()=>{
    const huge=new InternetMemes(async()=>new Response("x".repeat(256*1024+1),{headers:{"Content-Type":"application/json"}}));
    await expect(huge.load(new AbortController().signal)).rejects.toThrow("request-byte-budget-exceeded");
    const bad=new InternetMemes(async()=>new Response("<html>",{headers:{"Content-Type":"text/html"}}));
    await expect(bad.load(new AbortController().signal)).rejects.toThrow("meme-source-invalid");
    expect(huge.retainedBytes+bad.retainedBytes).toBe(0);
  });
  it("stops an already cancelled request before network access",async()=>{
    const provider=new InternetMemes(async()=>{throw new Error("Must not dispatch");}),controller=new AbortController();controller.abort();
    await expect(provider.load(controller.signal)).rejects.toThrow("cancelled");
    expect(provider.counters.metadataRequests).toBe(0);
  });
  it("does not promote the original pending catalog to production eligibility",async()=>{
    expect((await loadLocalCatalog(true)).assets.every(a=>!eligible(a))).toBe(true);
  });
  it("ranks the full bounded popular list locally and fetches metadata only, never the private query",async()=>{
    const data=payload();
    data.data.memes=Array.from({length:15},(_,i)=>({...data.data.memes[i%6],id:String(100+i),name:`Fixture ${i}`}));
    data.data.memes[14]={...data.data.memes[14],id:"87743020",name:"Two Buttons"};
    const requests:{url:string;init?:RequestInit}[]=[];
    const provider=new InternetMemes(async(url,init)=>{
      requests.push({url:String(url),init});return new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}});
    });
    const result=await provider.inspiration("PRIVATE-WORD Two choices and a dilemma",new AbortController().signal);
    expect(result.selection).toBe("local-keyword-match");
    expect(result.references[0]).toMatchObject({name:"Two Buttons",sourceUrl:"https://imgflip.com/meme/87743020"});
    expect(result.references).toHaveLength(1);
    expect(JSON.stringify(requests)).not.toContain("PRIVATE-WORD");
    expect(requests).toEqual([{url:memeEndpoint,init:expect.objectContaining({method:"GET",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer"})}]);
    expect(requests[0].init?.body).toBeUndefined();
    expect(provider.counters).toEqual({metadataRequests:1,imageRequests:0});expect(provider.retainedBytes).toBe(0);
    const chinese=await provider.inspiration("在两个选择中纠结",new AbortController().signal);
    expect(chinese.references[0].name).toBe("Two Buttons");
  });
  it("labels unmatched popular inspiration honestly and validates entries beyond the old first twelve",async()=>{
    const data=payload();
    const provider=new InternetMemes(async()=>new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}}));
    const result=await provider.inspiration("a spectacular nebula",new AbortController().signal);
    expect(result.selection).toBe("popular-fallback");expect(result.references).toHaveLength(3);
    data.data.memes=Array.from({length:15},(_,i)=>({...data.data.memes[i%6],id:String(100+i)}));
    data.data.memes[14].url="https://evil.test/private";
    await expect(provider.inspiration("nebula",new AbortController().signal)).rejects.toThrow("meme-source-invalid");
    expect(provider.counters.imageRequests).toBe(0);
  });
});
