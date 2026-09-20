import { createHash, randomBytes } from "node:crypto";
import type { InvocationEnvelope } from "../shared/types";
import { HttpError } from "./errors";

type Record = { envelope: InvocationEnvelope; expiresAt: number; idempotencyKey: string };
type Idempotency = { token: string; expiresAt: number };
export class InvocationStore {
  private readonly envelopes = new Map<string, Record>();
  private readonly idempotency = new Map<string, Idempotency>();
  constructor(private readonly now = () => Date.now(), private readonly bytes = () => randomBytes(32), private readonly ttlMs = 300_000) {
    if (ttlMs > 300_000 || ttlMs < 1) throw new Error("Invalid invocation TTL.");
  }
  createOrGet(idempotencyKey: string, envelope: InvocationEnvelope) {
    this.cleanup();
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) return existing.token;
    if (this.envelopes.size >= 100 || this.idempotency.size >= 200) throw new HttpError(503);
    const token = this.bytes().toString("base64url");
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid CSPRNG token.");
    const digest = hashToken(token);
    const expiresAt = this.now() + this.ttlMs;
    this.envelopes.set(digest, { envelope: structuredClone(envelope), expiresAt, idempotencyKey });
    this.idempotency.set(idempotencyKey, { token, expiresAt });
    return token;
  }
  claim(token: string): InvocationEnvelope | undefined {
    this.cleanup();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const digest = hashToken(token);
    const record = this.envelopes.get(digest);
    if (!record || record.expiresAt <= this.now()) return undefined;
    this.envelopes.delete(digest);
    this.idempotency.delete(record.idempotencyKey);
    return structuredClone(record.envelope);
  }
  close(invocationId: string) {
    for (const [digest, record] of this.envelopes) {
      if (record.envelope.binding.invocationId === invocationId) {
        this.envelopes.delete(digest); this.idempotency.delete(record.idempotencyKey);
      }
    }
  }
  counts() { this.cleanup(); return { envelopes: this.envelopes.size, idempotency: this.idempotency.size }; }
  private cleanup() {
    const now = this.now();
    for (const [digest, record] of this.envelopes) if (record.expiresAt <= now) this.envelopes.delete(digest);
    for (const [key, record] of this.idempotency) if (record.expiresAt <= now) this.idempotency.delete(key);
  }
}
const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");
