import type { ImageProfile, RunApproval } from "./local-generation-config";
import type { LocalGenerationDraft } from "../shared/local-chat";
import { randomUUID } from "node:crypto";
export function offlineProfile():ImageProfile {
  return {account:"your-azure-openai-resource",endpoint:"https://your-azure-openai-resource.openai.azure.com/",
    deployment:"offline-not-a-real-deployment",model:"gpt-image-1.5",modelVersion:"2025-12-16",region:"US",sku:"DataZoneStandard",
    apiVersion:"2025-04-01-preview",version:"OFFLINE-TEST-ONLY",expiresAt:Date.now()+3_600_000,minIntervalMs:61_000,
    evidence:{deployment:"OFFLINE FIXTURE",access:"OFFLINE FIXTURE",api:"OFFLINE FIXTURE",quota:"OFFLINE FIXTURE",resources:"OFFLINE FIXTURE",terms:"OFFLINE FIXTURE"}};
}
export function offlineApproval():RunApproval {
  return {mode:"ready",invocationNonce:`OFFLINE-${randomUUID()}`,expiresAt:Date.now()+600_000,approvedCalls:1,budgetVersion:"OFFLINE-ONE-FAKE-CALL",
    deploymentApproval:"OFFLINE FIXTURE",costApproval:"OFFLINE FIXTURE",contentApproval:"OFFLINE FIXTURE",acceptedCanary:"OFFLINE FIXTURE",
    acceptedRisks:["R01","R02","R03","R04","R05","R06"]};
}
export function offlineDraft():LocalGenerationDraft {
  return {intent:"An original geometric greeting for a fictional puzzle",creative:"A red square beside a blue circle",output:"image",context:[],
    preferences:{source:"requester-reported",language:"en",culture:"",familiarity:"",tone:"",relationship:"",humor:"",avoid:""}};
}
