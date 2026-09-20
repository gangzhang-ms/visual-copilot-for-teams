import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
const pending=vi.hoisted(()=>({workers:[] as {emit:(name:string,value?:unknown)=>boolean;options:Record<string,unknown>;exit:(value:number)=>void;fail:(error:Error)=>void}[]}));
vi.mock("node:worker_threads",()=>({Worker:class extends EventEmitter {
  exit!:(value:number)=>void;fail!:(error:Error)=>void;ending=new Promise<number>((resolve,reject)=>{this.exit=resolve;this.fail=reject;});
  constructor(_url:URL,readonly options:Record<string,unknown>){super();pending.workers.push(this);}
  terminate(){return this.ending;}
}}));
import { generatedMedia,reserveGeneratedWorker } from "./generated-media-host";
import { generatedWorkerLease } from "./local-generation-config";
it("reserves before spend and cannot release a physical worker via early reservation release",async()=>{
  const reservation=reserveGeneratedWorker(),abort=new AbortController();
  const result=generatedMedia("animate",new Uint8Array([1]),abort.signal,false,reservation);
  const worker=pending.workers.at(-1)!;reservation.release();expect(generatedWorkerLease.busy).toBe(true);
  abort.abort();await expect(generatedMedia("animate",new Uint8Array(),new AbortController().signal)).rejects.toThrow("generation-busy");
  expect(generatedWorkerLease.busy).toBe(true);worker.exit(1);
  await expect(result).rejects.toThrow("generation-cancelled");expect(generatedWorkerLease.busy).toBe(false);
});
it("ignores late messages and cancellation between message and confirmed exit cannot publish",async()=>{
  const abort=new AbortController(),result=generatedMedia("canonicalize",new Uint8Array([1]),abort.signal);
  const worker=pending.workers.at(-1)!;
  worker.emit("message",{ok:true,image:new Uint8Array([1]),diagnostics:{}});abort.abort();
  worker.emit("message",{ok:true,image:new Uint8Array([2]),diagnostics:{}});
  expect(generatedWorkerLease.busy).toBe(true);
  worker.exit(0);await expect(result).rejects.toThrow("generation-cancelled");expect(generatedWorkerLease.busy).toBe(false);
});
it("uses empty environment and a pixel-only worker payload, not inherited credentials",async()=>{
  process.env.GENERATION_TEST_SENTINEL="not-a-key";
  try {
    const result=generatedMedia("canonicalize",new Uint8Array([1]),new AbortController().signal),worker=pending.workers.at(-1)!;
    expect(worker.options.env).toEqual({});expect(worker.options.resourceLimits).toEqual({maxOldGenerationSizeMb:128});
    expect(Object.keys(worker.options.workerData as object).sort()).toEqual(["animated","bytes","operation"]);
    expect(JSON.stringify(worker.options)).not.toContain("not-a-key");
    worker.emit("message",{ok:true,image:new Uint8Array([1]),diagnostics:{}});worker.exit(0);await result;
  } finally {delete process.env.GENERATION_TEST_SENTINEL;}
});
it("the 15-second worker deadline still waits for actual termination",async()=>{
  vi.useFakeTimers();
  try{
    const result=generatedMedia("animate",new Uint8Array(),new AbortController().signal),worker=pending.workers.at(-1)!;
    let settled=false;void result.catch(()=>{settled=true;});
    await vi.advanceTimersByTimeAsync(14999);expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(false);expect(generatedWorkerLease.busy).toBe(true);
    worker.exit(1);await expect(result).rejects.toThrow("generation-worker-timeout");expect(generatedWorkerLease.busy).toBe(false);
  }finally{vi.useRealTimers();}
});
it("keeps native capacity unavailable when termination fails",async()=>{
  const abort=new AbortController(),result=generatedMedia("animate",new Uint8Array(),abort.signal),worker=pending.workers.at(-1)!;
  abort.abort();worker.fail(new Error("teardown failed"));
  await expect(result).rejects.toThrow("generation-worker-cleanup-failed");expect(generatedWorkerLease.busy).toBe(true);
  await expect(generatedMedia("animate",new Uint8Array(),new AbortController().signal)).rejects.toThrow("generation-busy");
});
