import {expect,it,vi} from "vitest";
import {searchWebImages,validateWebImageSearchQuery,type WebImageSearchProvider} from "./web-image-search";
const signal=()=>new AbortController().signal;
it("does not call a missing/unconfigured provider or substitute a catalog",async()=>{
  const search=vi.fn(),provider:WebImageSearchProvider={id:"UNCONFIGURED",configured:false,search};
  expect(await searchWebImages(undefined,undefined,signal())).toEqual({status:"unavailable",code:"web-image-search-not-configured"});
  expect(await searchWebImages(provider,{terms:"reaction"},signal())).toEqual({status:"unavailable",code:"web-image-search-not-configured"});
  expect(search).not.toHaveBeenCalled();
});
it.each([{terms:""},{terms:"a".repeat(181)},{terms:"line\nline"},{terms:"hello",context:["private"]},
  {terms:"hello",profile:{culture:"private"}},{intent:"full intent"}])("rejects invalid terms or extra private fields before dispatch",async query=>{
  const search=vi.fn(),provider:WebImageSearchProvider={id:"OFFLINE",configured:true,search};
  await expect(searchWebImages(provider,query,signal())).rejects.toThrow("web-image-search-invalid-query");
  expect(search).not.toHaveBeenCalled();
});
it("forwards only explicit terms unchanged and never treats metadata as insertable pixels",async()=>{
  const items=[{id:"fixture",title:"Fixture image",imageUrl:"https://images.example.invalid/a.jpg",sourcePageUrl:"https://pages.example.invalid/a"}];
  const search=vi.fn<WebImageSearchProvider["search"]>(async()=>items),query=validateWebImageSearchQuery({terms:"relieved reaction"});
  const result=await searchWebImages({id:"OFFLINE",configured:true,search},query,signal());
  expect(search.mock.calls[0][0]).toEqual({terms:"relieved reaction"});
  expect(result).toEqual({status:"metadata",provider:"OFFLINE",items});
  expect(result).not.toHaveProperty("visual");expect(result).not.toHaveProperty("imageBytes");
});
it("keeps an empty search explicit instead of supplying a fallback image",async()=>{
  expect(await searchWebImages({id:"OFFLINE",configured:true,search:async()=>[]},{terms:"rare reaction"},signal()))
    .toEqual({status:"empty",provider:"OFFLINE"});
});
it("discards a provider's late success after cancellation",async()=>{
  const controller=new AbortController();let finish!:(items:[])=>void;
  const work=searchWebImages({id:"OFFLINE",configured:true,search:()=>new Promise(resolve=>{finish=resolve;})},{terms:"reaction"},controller.signal);
  controller.abort();finish([]);
  await expect(work).rejects.toThrow("web-image-search-cancelled");
});
