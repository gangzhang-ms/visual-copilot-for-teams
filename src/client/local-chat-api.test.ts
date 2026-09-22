import {afterEach,expect,it,vi} from "vitest";
import {LocalRequestError,localRequest,beginLocalWork,localActivity,observeLocalState,ensureLocalSpeaker} from "./local-chat-api";
import type {LocalState} from "../shared/local-chat";
afterEach(()=>vi.unstubAllGlobals());
it("fences a whole interactive operation and its requests without counting observation as work",async()=>{
  vi.stubGlobal("fetch",async()=>Response.json({revision:1,messages:[]}));
  const initial=localActivity(),finish=beginLocalWork();
  expect(localActivity().pending).toBe(1);
  const during=localActivity().version;
  await observeLocalState(new AbortController().signal);
  expect(localActivity()).toEqual({pending:1,version:during});
  await localRequest("state");expect(localActivity().pending).toBe(1);
  finish();finish();expect(localActivity()).toEqual({pending:0,version:initial.version+4});
});
it("releases failed request activity and reasserts a local speaker only during explicit preparation",async()=>{
  const state:LocalState={revision:1,messages:[],catalogAccepted:false,cooldownUntil:0,providerRequests:0,outgoingSpeaker:"Alex"};
  const fetcher=vi.fn(async()=>Response.json({...state,revision:2,outgoingSpeaker:"Maya"}));vi.stubGlobal("fetch",fetcher);
  expect(await ensureLocalSpeaker(state,"Alex")).toBe(state);expect(fetcher).not.toHaveBeenCalled();
  expect(await ensureLocalSpeaker(state,"Maya")).toMatchObject({revision:2,outgoingSpeaker:"Maya"});
  expect(fetcher.mock.calls).toHaveLength(1);
  vi.stubGlobal("fetch",async()=>{throw new TypeError("offline");});
  await expect(localRequest("message")).rejects.toThrow("offline");expect(localActivity().pending).toBe(0);
});
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
it("accepts only allowlisted context-planner diagnostic categories, never provider prose",async()=>{
  vi.stubGlobal("fetch",async()=>Response.json({code:"generation-context-planning",planningReason:"evidence"},{status:400}));
  await expect(localRequest("generation/batch/review")).rejects.toMatchObject({message:"generation-context-planning",planningReason:"evidence"});
  expect(new LocalRequestError("generation-context-planning",undefined,"PRIVATE_PROVIDER_BODY").planningReason).toBeUndefined();
  expect(new LocalRequestError("busy",undefined,"schema").planningReason).toBeUndefined();
});
it("retains allowlisted field/type/rule diagnostics but rejects arbitrary provider data",async()=>{
  const issue={field:"reason",actualType:"string",rule:"length"};
  vi.stubGlobal("fetch",async()=>Response.json({code:"generation-context-planning",planningReason:"schema",planningIssues:[issue]},{status:400}));
  await expect(localRequest("generation/batch/review")).rejects.toMatchObject({planningIssues:[issue]});
  for(const planningIssues of [[{...issue,field:"PRIVATE_FIELD"}],[{...issue,rule:"PRIVATE_VALUE"}],[{...issue,actualType:"PRIVATE_TYPE"}],
    [{...issue,raw:"PRIVATE_PROVIDER_BODY"}],Array.from({length:21},()=>issue),issue]){
    expect(new LocalRequestError("generation-context-planning",undefined,"schema",planningIssues).planningIssues).toBeUndefined();
  }
  expect(new LocalRequestError("busy",undefined,"schema",[issue]).planningIssues).toBeUndefined();
});
it("retains safe semantic evidence diagnostics rather than discarding them",async()=>{
  const issue={field:"familiarity",actualType:"string",rule:"audience-report-required"};
  vi.stubGlobal("fetch",async()=>Response.json({code:"generation-context-planning",planningReason:"evidence",planningIssues:[issue]},{status:400}));
  await expect(localRequest("generation/batch/review")).rejects.toMatchObject({planningReason:"evidence",planningIssues:[issue]});
  expect(new LocalRequestError("generation-context-planning",undefined,"evidence",[{...issue,value:"PRIVATE"}]).planningIssues).toBeUndefined();
});
it("preserves bounded numeric text-length diagnostics and rejects invalid measurements",async()=>{
  const issue={field:"reason",actualType:"string",rule:"length",actualLength:321,limit:320};
  vi.stubGlobal("fetch",async()=>Response.json({code:"generation-context-planning",planningReason:"schema",planningIssues:[issue]},{status:400}));
  await expect(localRequest("generation/batch/review")).rejects.toMatchObject({planningIssues:[issue]});
  for(const invalid of [{...issue,actualLength:64_001},{...issue,actualLength:Infinity},{...issue,actualLength:320},
    {...issue,actualLength:1.5},{...issue,limit:-1},{...issue,limit:"PRIVATE"},{...issue,rule:"empty"},
    {...issue,actualType:"array"},{...issue,raw:"PRIVATE_TEXT"}]){
    expect(new LocalRequestError("generation-context-planning",undefined,"schema",[invalid]).planningIssues).toBeUndefined();
  }
});
it("accepts bounded reference paths, not arbitrary nested keys or provider values",()=>{
  for(const field of ["reference","reference.kind","reference.choice","reference.sourceId","reference.work","reference.characters","reference.hook",
    "appearance","appearance.style","appearance.frameId"]){
    const issue={field,actualType:"object",rule:"unexpected-fields"};
    expect(new LocalRequestError("generation-context-planning",undefined,"schema",[issue]).planningIssues).toEqual([issue]);
  }
  expect(new LocalRequestError("generation-context-planning",undefined,"schema",
    [{field:"reference.PRIVATE_KEY",actualType:"string",rule:"type"}]).planningIssues).toBeUndefined();
});
