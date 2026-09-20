import {expect,it} from "vitest";
import {loadLocalChatConfig} from "./local-chat-config";
import {modelRequestLimit,modelTransportBytes,validProfile} from "./visual-config";
import {preflight} from "./model-gateway";
import {roomMediaPolicy,withinRoomMediaBudget} from "./local-generation-config";
import {failure} from "./visual-errors";

it("removes the personal profile budget without replacing it with a larger quota",()=>{
  const config=loadLocalChatConfig("fixture",true),profile=config.profile!;
  expect(profile.requestBytes).toBeNull();expect(modelRequestLimit(profile)).toBe(modelTransportBytes);
  expect(validProfile(profile,Date.now(),"development-local")).toBe(true);
  expect(validProfile({...profile,verified:true},Date.now(),"production")).toBe(false);
  const legacy=loadLocalChatConfig("fixture").profile!;
  expect(legacy.requestBytes).toBe(256*1024);
  expect(validProfile({...legacy,requestBytes:null},Date.now(),"development-local")).toBe(false);
  expect(validProfile({...legacy,verified:true},Date.now(),"production")).toBe(true);
  expect(validProfile({...legacy,verified:true,requestBytes:null},Date.now(),"production")).toBe(false);
  const media={samples:[],coverage:[]};
  expect(preflight("x".repeat(256*1024+1),profile,media,1,1000,"development-local").serializedBytes).toBe(256*1024+1);
  expect(()=>preflight("x".repeat(256*1024+1),legacy,media,1,1000,"development-local")).toThrow("request-byte-budget-exceeded");
});
it("enforces the actual transport envelope with safe measured/allowed bytes, not a room-delete error",()=>{
  const profile=loadLocalChatConfig("fixture",true).profile!,body="x".repeat(modelTransportBytes+1);
  expect(preflight(body.slice(1),profile,{samples:[],coverage:[]},1,1000,"development-local").serializedBytes).toBe(modelTransportBytes);
  try{preflight(body,profile,{samples:[],coverage:[]},1,1000,"development-local");throw new Error("Expected bound");}
  catch(error){expect(failure(error)).toEqual({status:"blocked",code:"model-request-envelope-exceeded",byteLimit:{actualBytes:modelTransportBytes+1,allowedBytes:modelTransportBytes}});}
  expect(()=>preflight("{}",profile,{samples:[],coverage:[]},40000,1000,"development-local")).toThrow("request-token-budget-exceeded");
});
it("keeps accounting-only admission separate from legacy per-room bytes",()=>{
  const direct=roomMediaPolicy(true),legacy=roomMediaPolicy(false);
  expect(direct).toEqual({kind:"account-only"});
  for(const bytes of [8*1024*1024+1,24*1024*1024,60*1024*1024])expect(withinRoomMediaBudget(bytes,direct)).toBe(true);
  expect(withinRoomMediaBudget(8*1024*1024+1,legacy)).toBe(false);
  expect(withinRoomMediaBudget(8*1024*1024,legacy)).toBe(true);
});
