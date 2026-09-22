import type { FailureCode } from "../shared/types";
export class VisualError extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}
export class PlanningSchemaError extends VisualError {
  constructor(readonly issues:import("../shared/local-chat").PlanningSchemaIssue[]){super("model-output-invalid-schema");}
}
export class PlanningEvidenceError extends VisualError {
  constructor(readonly issues:import("../shared/local-chat").PlanningSchemaIssue[]){super("model-output-invalid-references");}
}
export class ModelRequestEnvelopeError extends VisualError {
  constructor(readonly actualBytes:number,readonly allowedBytes:number){super("model-request-envelope-exceeded");}
}
export function requireVisual(condition: unknown, code: FailureCode): asserts condition {
  if (!condition) throw new VisualError(code);
}
export function failure(error: unknown) {
  return { status: "blocked" as const, code: error instanceof VisualError ? error.code : "not-configured" as const,
    ...(error instanceof ModelRequestEnvelopeError?{byteLimit:{actualBytes:error.actualBytes,allowedBytes:error.allowedBytes}}:{}) };
}
