import {afterEach,expect,it,vi} from "vitest";
import {LocalRequestError,localRequest} from "./local-chat-api";
afterEach(()=>vi.unstubAllGlobals());
it("preserves safe measured envelope metadata from an actual failed request",async()=>{
  vi.stubGlobal("fetch",async()=>Response.json({code:"model-request-envelope-exceeded",byteLimit:{actualBytes:12582913,allowedBytes:12582912}},{status:400}));
  await expect(localRequest("review")).rejects.toMatchObject({message:"model-request-envelope-exceeded",byteLimit:{actualBytes:12582913,allowedBytes:12582912}});
});
it("does not display malformed, unrelated or unbounded server error metadata",()=>{
  for(const values of [{actualBytes:Infinity,allowedBytes:1},{actualBytes:1,allowedBytes:2},{actualBytes:"private",allowedBytes:1},{actualBytes:2,allowedBytes:0}]){
    expect(new LocalRequestError("model-request-envelope-exceeded",values).byteLimit).toBeUndefined();
  }
  expect(new LocalRequestError("busy",{actualBytes:2,allowedBytes:1}).byteLimit).toBeUndefined();
});
