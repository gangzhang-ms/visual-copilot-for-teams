import { expect,it,vi } from "vitest";
import { ongoingPersonalGenerationOptions } from "./personal-image";
import { consumeAdmission,generationReadiness } from "./local-generation-config";
import { loadLocalChatConfig } from "./local-chat-config";
import { validProfile } from "./visual-config";
import { loadLocalCatalog } from "./local-catalog";
import { eligible } from "./visual-retrieval";
it("ongoing personal mode has no count or date allowance and does not reuse the historical journal",()=>{
  const {profile,admission}=ongoingPersonalGenerationOptions();
  expect(profile.expiresAt).toBeNull();
  for(let i=0;i<8;i++)consumeAdmission(profile,admission,"reviewed-body",false,`independent-${i}`);
  const clock=vi.spyOn(Date,"now").mockReturnValue(Date.parse("2030-01-01"));
  try{expect(generationReadiness(profile,admission)).toMatchObject({ready:true,remainingCalls:null,scope:"ongoing-personal"});}
  finally{clock.mockRestore();}
  expect(generationReadiness({...profile,deployment:"different"},admission).ready).toBe(false);
  expect(generationReadiness(profile,{}).ready).toBe(false);
});
it("direct local inventory is usable without promoting pending original assets into production",async()=>{
  const catalog=await loadLocalCatalog(true);
  expect(catalog.assets).toHaveLength(8);
  for(const asset of catalog.assets){
    expect(catalog.permits(asset,catalog.digest)).toBe(true);
    expect(asset.rights.approved).toBe(false);expect(asset.safe).toBe(false);
    expect(eligible(asset)).toBe(false);
    expect(asset.public.notices.text.join(" ")).not.toContain("permission attestation");
  }
});
it("ongoing decoder validity is local only, pinned, and never production evidence",()=>{
  const config=loadLocalChatConfig("OFFLINE-KEY",true);
  expect(config.profile?.validUntil).toBeNull();
  expect(validProfile(config.profile,Date.parse("2030-01-01"),"development-local")).toBe(true);
  expect(validProfile(config.profile,Date.now(),"production")).toBe(false);
  expect(validProfile({...config.profile!,deployment:"different"},Date.now(),"development-local")).toBe(false);
});
