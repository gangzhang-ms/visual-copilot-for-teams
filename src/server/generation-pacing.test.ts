import {afterEach,expect,it,vi} from "vitest";
import {generationPacing,generationReadiness,LocalLease,localPaidLease,generatedWorkerLease,loadGenerationProfile} from "./local-generation-config";
import {ongoingPersonalGenerationOptions} from "./personal-image";
import {offlineProfile} from "./generation.test.support";
afterEach(()=>{vi.restoreAllMocks();localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;});
it("selects provider-only pacing from bound personal admission, not a forged token or zero profile",()=>{
  const {profile,admission}=ongoingPersonalGenerationOptions();
  expect(profile.minIntervalMs).toBe(61000);
  expect(generationPacing(profile,admission)).toEqual({kind:"provider-backoff-only"});
  expect(generationPacing(profile,{})).toEqual({kind:"fixed-interval",intervalMs:61000});
  expect(generationPacing({...profile,version:"forged"},admission).kind).toBe("fixed-interval");
  expect(loadGenerationProfile({...offlineProfile(),minIntervalMs:0})).toBeUndefined();
});
it("personal requests ignore local image/text pacing but honor physical leases and actual backoff",()=>{
  let now=100_000;vi.spyOn(Date,"now").mockImplementation(()=>now);
  const {profile,admission}=ongoingPersonalGenerationOptions(),policy=generationPacing(profile,admission);
  localPaidLease.pace(61000);
  expect(generationReadiness(profile,admission)).toMatchObject({ready:true,reason:"available",cooldownUntil:0});
  const first=localPaidLease.acquire(policy);first.dispatched();
  expect(generationReadiness(profile,admission)).toMatchObject({ready:false,reason:"generation-busy"});
  expect(()=>localPaidLease.acquire(policy)).toThrow("generation-busy");
  first.release();first.release();
  const second=localPaidLease.acquire(policy);second.dispatched();second.release();
  expect(generationReadiness(profile,admission).ready).toBe(true);
  const native=generatedWorkerLease.acquire();
  expect(generationReadiness(profile,admission)).toMatchObject({ready:false,reason:"generation-busy"});
  native.release();
  localPaidLease.defer(2000);
  expect(generationReadiness(profile,admission)).toMatchObject({ready:false,reason:"generation-cooling-down",cooldownUntil:102_000});
  expect(()=>localPaidLease.acquire(policy)).toThrow();
  now+=1999;expect(generationReadiness(profile,admission).ready).toBe(false);
  now++;const retry=localPaidLease.acquire(policy);retry.release();
  expect(generationReadiness(profile,admission).ready).toBe(true);
});
it("finite/legacy image pacing and text pacing retain their own original intervals",()=>{
  let now=100_000;vi.spyOn(Date,"now").mockImplementation(()=>now);
  const lease=new LocalLease(),policy=generationPacing(offlineProfile());
  const first=lease.acquire(policy);first.dispatched();first.release();
  now+=60_999;expect(()=>lease.acquire(policy)).toThrow();
  now++;const second=lease.acquire(policy);second.release();
  const text=new LocalLease(),call=text.acquire(6100);call.dispatched();call.release();
  now+=6099;expect(()=>text.acquire(6100)).toThrow();
  now++;text.acquire(6100).release();
});
it("provider-only policy cannot bypass poisoned physical cleanup",()=>{
  const lease=new LocalLease(),policy={kind:"provider-backoff-only"} as const,held=lease.acquire(policy);
  lease.poison();held.release();
  expect(lease.busy).toBe(true);expect(()=>lease.acquire(policy)).toThrow("generation-busy");
});
