import type { ILogger } from "@microsoft/teams.common";
export const privacyEvents = ["invoke_accepted", "invoke_rejected", "claim_succeeded", "claim_rejected", "visual_request_accepted", "visual_request_blocked", "session_closed"] as const;
export type PrivacyEvent = (typeof privacyEvents)[number];
export class PrivacyLogger {
  private readonly counters = new Map<PrivacyEvent, number>();
  record(event: PrivacyEvent) {
    if (!privacyEvents.includes(event)) return;
    this.counters.set(event, (this.counters.get(event) ?? 0) + 1);
  }
  count(event: PrivacyEvent) { return this.counters.get(event) ?? 0; }
}
export class SilentSdkLogger implements ILogger {
  debug() {} info() {} warn() {} error() {} trace() {} log() {}
  child() { return this; }
}
