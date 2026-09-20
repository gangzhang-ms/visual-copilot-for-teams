import { expect, it, vi } from "vitest";
import { decodeImageResponse, ImageGenerationGateway, imageResponseBytes, type ImageCapabilityState } from "./image-generation-gateway";
import { generationLimits, localPaidLease } from "./local-generation-config";
import { buildCreativeBrief } from "./local-generation";
import { offlineDraft, offlineProfile } from "./generation.test.support";
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const encode=(data:unknown)=>Buffer.from(JSON.stringify(data));
it.each([{data:[]},{data:[{},{}]},{data:[{url:"https://untrusted.example/x"}]},{data:[{url:"x",b64_json:signature.toString("base64")}]},
  {data:[{b64_json:""}]},{data:[{b64_json:"abcd==="}]},{data:[{b64_json:"YQ==\n"}]},{data:[{b64_json:"not PNG"}]},{choices:[]}])("rejects non-image response contract %#",value=>{
  expect(()=>decodeImageResponse(encode(value))).toThrow("generation-invalid-response");
});
it("applies base64 and decoded envelope caps without claiming signature-only bytes form a valid PNG",()=>{
  const bytes=Buffer.alloc(generationLimits.decoded);signature.copy(bytes);
  const base64=bytes.toString("base64");expect(base64.length).toBe(11_184_812);
  expect(decodeImageResponse(encode({data:[{b64_json:base64}]})).length).toBe(generationLimits.decoded);
  const over=Buffer.concat([bytes,Buffer.from([0])]).toString("base64");expect(()=>decodeImageResponse(encode({data:[{b64_json:over}]}))).toThrow();
  expect(()=>decodeImageResponse(encode({data:[{b64_json:base64+"A"}]}))).toThrow();
  expect(()=>decodeImageResponse(Buffer.from("{"))).toThrow();
});
it("bounds streaming even when Content-Length lies and cancels the reader",async()=>{
  let cancelled=0;
  const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled++;}});
  await expect(imageResponseBytes(new Response(stream,{headers:{"Content-Length":"1"}}),new AbortController().signal)).rejects.toThrow("generation-response-too-large");
  expect(cancelled).toBe(1);
});
it("accepts exactly the streamed JSON cap, rejects one extra byte, and reacts to an aborted read",async()=>{
  const cap=generationLimits.response;
  const response=(size:number)=>new Response(new Uint8Array(size));
  expect((await imageResponseBytes(response(cap),new AbortController().signal)).length).toBe(cap);
  await expect(imageResponseBytes(response(cap+1),new AbortController().signal)).rejects.toThrow();
  const abort=new AbortController(),stream=new ReadableStream<Uint8Array>();
  const pending=imageResponseBytes(new Response(stream),abort.signal);abort.abort();
  await expect(pending).rejects.toThrow("generation-cancelled");
});
it("pins destination/body/options, sends no reference image and never fetches response URLs",async()=>{
  const p=offlineProfile(),body=buildCreativeBrief(offlineDraft(),[]).body;
  const transport=vi.fn<typeof fetch>(async(_url,_init)=>new Response(JSON.stringify({data:[{b64_json:signature.toString("base64")}]}),{headers:{"Content-Type":"application/json"}}));
  const gateway=new ImageGenerationGateway("fake-only",transport);
  await gateway.run(p,body,new AbortController().signal);
  const [url,init]=transport.mock.calls[0];
  expect(url).toBe(`${p.endpoint}openai/deployments/${p.deployment}/images/generations?api-version=2025-04-01-preview`);
  expect(init!.body).toBe(body);expect(init!.redirect).toBe("error");expect(transport).toHaveBeenCalledTimes(1);
  await expect(gateway.run({...p,endpoint:"https://untrusted.example/"},body,new AbortController().signal)).rejects.toThrow();
  await expect(gateway.run(p,JSON.stringify({...JSON.parse(body),n:2}),new AbortController().signal)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
it.each([400,401,403,413,422,429,503])("fails safely without retries or provider text for HTTP %s",async status=>{
  const transport=vi.fn(async()=>new Response("PRIVATE PROVIDER ERROR",{status,headers:{"retry-after":"999999"}}));
  const gateway=new ImageGenerationGateway("fake-only",transport),p=offlineProfile();
  await expect(gateway.run(p,buildCreativeBrief(offlineDraft(),[]).body,new AbortController().signal)).rejects.not.toThrow("PRIVATE");
  expect(transport).toHaveBeenCalledTimes(1);expect(gateway.suspended).toBe([401,403].includes(status));
  if(status===429)expect(localPaidLease.nextAt-Date.now()).toBeLessThanOrEqual(300_000);
});
it.each([
  [400,{error:{code:"content_policy_violation",message:"PRIVATE"}}, "generation-refused",false],
  [400,{error:{code:"BadRequest",innererror:{code:"ResponsibleAIPolicyViolation",message:"PRIVATE"}}},"generation-refused",false],
  [403,{error:{code:"content_filter"}},"generation-refused",false],
  [400,{error:{code:"invalid_request_error",message:"PRIVATE"}},"generation-request-rejected",false],
  [422,{error:{code:"unknown-private-code"}},"generation-request-rejected",false],
  [400,{error:{code:"OperationNotSupported"}},"generation-capability-unavailable",true],
  [404,{error:{code:"DeploymentNotFound"}},"generation-capability-unavailable",true],
  [400,{error:{code:"InvalidApiVersionParameter"}},"generation-capability-unavailable",true],
  [401,{error:{message:"PRIVATE"}},"generation-access-denied",true],
  [402,{error:{message:"PRIVATE"}},"generation-billing-unavailable",true]
] as const)("classifies HTTP %s by bounded code fields, not messages: %#",async(status,error,code,blocked)=>{
  const capability:ImageCapabilityState={},transport=vi.fn(async()=>new Response(JSON.stringify(error),{status,headers:{"content-type":"application/json"}}));
  const gateway=new ImageGenerationGateway("fake",transport,capability);
  await expect(gateway.run(offlineProfile(),buildCreativeBrief(offlineDraft(),[]).body,new AbortController().signal)).rejects.toThrow(code);
  expect(gateway.suspended).toBe(blocked);expect(transport).toHaveBeenCalledTimes(1);
  expect(gateway.metrics).toMatchObject({httpStatus:status,failureCode:code});
  expect(JSON.stringify(gateway.metrics)).not.toMatch(/PRIVATE|unknown-private-code/);
  expect(new ImageGenerationGateway("fake",transport,capability).suspended).toBe(blocked);
  expect(new ImageGenerationGateway("fake",transport).suspended).toBe(false);
});
it.each([null,"{",JSON.stringify({error:{message:"content_policy_violation"}})," ".repeat(32769)])("rejects malformed/oversize/unrecognized error bodies without inventing content-policy evidence %#",async body=>{
  const gateway=new ImageGenerationGateway("fake",async()=>new Response(body,{status:400,headers:{"content-type":"application/json"}}));
  await expect(gateway.run(offlineProfile(),buildCreativeBrief(offlineDraft(),[]).body,new AbortController().signal)).rejects.toThrow("generation-request-rejected");
  expect(gateway.suspended).toBe(false);
});
it("rejects redirects, HTML, malformed contracts and zero credentials before dispatch",async()=>{
  const p=offlineProfile(),body=buildCreativeBrief(offlineDraft(),[]).body;
  for(const response of [new Response("HTML",{headers:{"Content-Type":"text/html"}}),new Response("{}",{headers:{"Content-Type":"application/json"}}),new Response(null,{status:302})]){
    const gateway=new ImageGenerationGateway("fake-only",async()=>response);
    await expect(gateway.run(p,body,new AbortController().signal)).rejects.toThrow();
  }
  const transport=vi.fn();await expect(new ImageGenerationGateway("",transport).run(p,body,new AbortController().signal)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
it("uses the exact 120-second HTTP deadline and reports unknown timeout without a retry",async()=>{
  const controller=new AbortController(),timeout=vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>{expect(ms).toBe(120_000);return controller.signal;});
  const transport=vi.fn<typeof fetch>(async(_url,init)=>new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener("abort",()=>reject(new Error("aborted")),{once:true})));
  try{
    const pending=new ImageGenerationGateway("fake",transport).run(offlineProfile(),buildCreativeBrief(offlineDraft(),[]).body,new AbortController().signal);
    controller.abort();await expect(pending).rejects.toThrow("generation-timeout");expect(transport).toHaveBeenCalledTimes(1);
  }finally{timeout.mockRestore();}
});
