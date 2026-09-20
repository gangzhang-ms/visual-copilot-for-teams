import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ImageAllowance } from "./image-allowance";
import { digest } from "./analysis-session";
import { consumeAdmission, generationReadiness, issueGenerationAdmission } from "./local-generation-config";
import { offlineApproval, offlineProfile } from "./generation.test.support";
const directories:string[]=[];
function ledger(owner="test-owner"){
  const path=mkdtempSync(join(tmpdir(),"image-allowance-"));directories.push(path);
  return new ImageAllowance(path,{authorizationId:"test-approval",approvedAt:Date.now()-1000,expiresAt:Date.now()+600_000,owner});
}
afterEach(()=>{vi.restoreAllMocks();for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
it("starts with exactly one canary and three ordinary calls and never refills on reinitialization",()=>{
  const l=ledger();l.initialize();l.consume("canary","first");l.finish("first","failed");l.initialize();
  expect(l.status("canary").remaining).toBe(0);expect(l.status("ordinary").remaining).toBe(3);
  expect(()=>l.consume("canary","second")).toThrow();
  expect(()=>l.consume("ordinary","ordinary")).toThrow("generation-canary-required");
});
it("fails closed on missing/corrupt state, foreign owner and an interrupted write lock",()=>{
  const l=ledger();l.initialize();
  expect(()=>new ImageAllowance(l.directory,{...l.authorization,owner:"another"}).status("canary")).toThrow();
  writeFileSync(join(l.directory,"write.lock"),"");expect(()=>l.consume("canary","one",1000)).toThrow("generation-allowance-busy");
  unlinkSync(join(l.directory,"write.lock"));writeFileSync(join(l.directory,"events.jsonl"),"{broken");
  expect(()=>l.status("canary")).toThrow("generation-allowance-unavailable");
  unlinkSync(join(l.directory,"events.jsonl"));expect(()=>l.initialize()).toThrow();
});
it("persists 61-second pacing, unresolved attempts, failure/cancel consumption and exactly three ordinary calls across instances",()=>{
  let now=Date.now();vi.spyOn(Date,"now").mockImplementation(()=>now);
  const l=ledger();l.initialize();l.consume("canary","canary");l.finish("canary","ready");l.verifyCanary(digest("OFFLINE technical fixture only"));
  const restart=()=>new ImageAllowance(l.directory,l.authorization);
  expect(restart().status("ordinary").reason).toBe("generation-cooling-down");
  now+=61_001;restart().consume("ordinary","ordinary-one");
  expect(restart().status("ordinary")).toMatchObject({remaining:2,reason:"generation-operation-unresolved"});
  now+=61_001;expect(()=>restart().consume("ordinary","duplicate")).toThrow("generation-operation-unresolved");
  restart().finish("ordinary-one","generation-provider-unavailable");
  restart().consume("ordinary","ordinary-two");restart().finish("ordinary-two","cancelled");
  now+=61_001;restart().consume("ordinary","ordinary-three");restart().finish("ordinary-three","ready");
  restart().initialize();expect(restart().status("ordinary").remaining).toBe(0);
  now+=61_001;expect(()=>restart().consume("ordinary","four")).toThrow("generation-budget-exhausted");
});
it("does not restore allowance after a crashed attempt or expired grant",()=>{
  const l=ledger();l.initialize();l.consume("canary","crashed");
  const restart=new ImageAllowance(l.directory,l.authorization);restart.initialize();
  expect(restart.status("canary").remaining).toBe(0);expect(restart.status("ordinary").reason).toBe("generation-operation-unresolved");
  expect(()=>restart.verifyCanary(digest("OFFLINE"))).toThrow();
  vi.spyOn(Date,"now").mockReturnValue(l.authorization.expiresAt);
  expect(restart.status("ordinary").reason).toBe("generation-approval-expired");
});
it("binds personal admission to its durable grant and real technical marker without asserting blanket risk acceptance",()=>{
  const l=ledger();l.initialize();
  const profile=offlineProfile(),approval={...offlineApproval(),mode:"validation-only" as const,acceptedRisks:[],expiresAt:l.authorization.expiresAt,
    syntheticBodyDigest:digest("EXACT OFFLINE BODY"),personalAuthorization:{id:l.authorization.authorizationId,approvedAt:l.authorization.approvedAt,scope:"personal-local-images" as const}};
  expect(()=>issueGenerationAdmission(profile,approval)).toThrow("generation-approval-required");
  expect(()=>issueGenerationAdmission(profile,{...approval,personalAuthorization:{...approval.personalAuthorization,id:"foreign"}},l.budget("canary"))).toThrow();
  const token=issueGenerationAdmission(profile,approval,l.budget("canary"));
  expect(generationReadiness(profile,token)).toMatchObject({mode:"validation-only",ready:false,durable:true,remainingCalls:1});
  expect(()=>consumeAdmission(profile,token,digest("EXACT OFFLINE BODY"),false)).toThrow();
  consumeAdmission(profile,token,digest("EXACT OFFLINE BODY"),true,"operator");
  expect(()=>consumeAdmission(profile,token,digest("EXACT OFFLINE BODY"),true,"again")).toThrow();
  expect(issueGenerationAdmission(profile,approval,l.budget("canary"))).toBe(token);
  expect(generationReadiness(profile,token).remainingCalls).toBe(0);
  l.finish("operator","failed");
  expect(()=>issueGenerationAdmission(profile,{...approval,mode:"ready",invocationNonce:"another-offline-personal-run",approvedCalls:3,
    personalAuthorization:{...approval.personalAuthorization,technicalCanary:digest("not measured")}},l.budget("ordinary"))).toThrow("generation-canary-required");
});
