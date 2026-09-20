import { Worker } from "node:worker_threads";
import { freemem } from "node:os";
import { generatedWorkerLease, generationLimits, GenerationError, requireGeneration } from "./local-generation-config";
export interface GeneratedWorkerResult {
  image?: Uint8Array; animation?: Uint8Array; derivative?: Uint8Array;
  diagnostics: { elapsedMs: number; cpuMicros: { user: number; system: number }; rssStart: number; rssEnd: number; isolatedEnvironment: boolean };
}
interface Reservation { release: () => void }
const reservations=new WeakMap<Reservation,{release:()=>void;inUse:boolean;pending:boolean}>();
export function reserveGeneratedWorker() {
  requireGeneration(freemem() >= 512 * 1024 * 1024, "generation-host-headroom");
  const lease=generatedWorkerLease.acquire();
  const reservation:Reservation={release:()=>{
    const state=reservations.get(reservation);if(!state)return;
    if(state.inUse){state.pending=true;return;}
    state.release();reservations.delete(reservation);
  }};
  reservations.set(reservation,{release:lease.release,inUse:false,pending:false});return reservation;
}
export async function generatedMedia(operation: "canonicalize" | "animate" | "explain", bytes: Uint8Array, signal: AbortSignal, animated = false, reserved?: Reservation): Promise<GeneratedWorkerResult> {
  const lease=reserved??reserveGeneratedWorker(),state=reservations.get(lease);
  requireGeneration(state&&!state.inUse,"generation-lease-required");state.inUse=true;
  try {
    requireGeneration(!signal.aborted, "generation-cancelled");
    return await new Promise<GeneratedWorkerResult>((resolve, reject) => {
      const worker = new Worker(new URL("./generated-media-worker.js", import.meta.url),
        { env: {}, workerData: { operation, bytes, animated }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      let finished = false;
      const finish = async (error?: GenerationError, value?: GeneratedWorkerResult) => {
        if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
        // Physical teardown is part of the awaited operation, not fire-and-forget cleanup.
        try { await worker.terminate(); } catch { generatedWorkerLease.poison(); reject(new GenerationError("generation-worker-cleanup-failed")); return; }
        if(signal.aborted&&!error)error=new GenerationError("generation-cancelled");
        error ? reject(error) : resolve(value!);
      };
      const abort = () => { void finish(new GenerationError("generation-cancelled")); };
      const timer = setTimeout(() => { void finish(new GenerationError("generation-worker-timeout")); }, generationLimits.workerMs);
      signal.addEventListener("abort", abort, { once: true });
      worker.once("message", (value: GeneratedWorkerResult & { ok: boolean }) => { void finish(value.ok ? undefined : new GenerationError("generation-media-rejected"), value); });
      worker.once("error", () => { void finish(new GenerationError("generation-media-rejected")); });
      worker.once("exit", () => { if (!finished) void finish(new GenerationError("generation-worker-exited")); });
      if (signal.aborted) abort();
    });
  } finally { state.inUse=false;if(!reserved||state.pending)lease.release(); }
}
