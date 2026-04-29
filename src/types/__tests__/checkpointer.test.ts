import { describe, it, expect, beforeEach } from "bun:test";
import { EventCache } from "@rhythmiclab/rhythmic-events";
import { Checkpointer } from "../checkpointer.js";
import type { BaseWorkflowState } from "../workflow.js";

interface TestState extends BaseWorkflowState<string, string> {
  payload: string;
}

const makeState = (overrides?: Partial<TestState>): TestState => ({
  currentStep: "step1",
  stepHistory: [],
  status: "running",
  retryCount: 0,
  maxRetries: 3,
  startTime: new Date().toISOString(),
  payload: "hello",
  ...overrides,
});

describe("Checkpointer (EventCache)", () => {
  let cache: EventCache;
  let cp: Checkpointer<TestState>;
  const threadId = "test-thread-123";

  beforeEach(() => {
    cache = new EventCache({ maxSize: 100, ttl: 60_000 });
    cp = new Checkpointer<TestState>(cache, "test");
  });

  it("save + load round-trips state", async () => {
    const state = makeState({ payload: "world" });
    await cp.save(threadId, state, "step1", "running");
    const loaded = await cp.load(threadId);
    expect(loaded).not.toBeNull();
    expect(loaded?.payload).toBe("world");
    expect(loaded?.currentStep).toBe("step1");
  });

  it("save + getStatus returns correct status", async () => {
    const state = makeState();
    await cp.save(threadId, state, "step2", "completed");
    const status = await cp.getStatus(threadId);
    expect(status).not.toBeNull();
    expect(status?.status).toBe("completed");
    expect(status?.step).toBe("step2");
    expect(status?.threadId).toBe(threadId);
  });

  it("save preserves createdAt across multiple saves", async () => {
    await cp.save(threadId, makeState(), "step1", "running");
    const first = await cp.getStatus(threadId);
    await cp.save(threadId, makeState(), "step2", "completed");
    const second = await cp.getStatus(threadId);
    expect(second?.createdAt).toBe(first?.createdAt);
  });

  it("updateStatus patches without losing other fields", async () => {
    await cp.save(threadId, makeState(), "step1", "running");
    await cp.updateStatus(threadId, "failed", "step1", "something broke");
    const status = await cp.getStatus(threadId);
    expect(status?.status).toBe("failed");
    expect(status?.error).toBe("something broke");
    expect(status?.threadId).toBe(threadId);
  });

  it("listThreads returns saved thread IDs", async () => {
    await cp.save("thread-a", makeState(), "step1", "running");
    await cp.save("thread-b", makeState(), "step1", "running");
    const threads = await cp.listThreads();
    expect(threads).toContain("thread-a");
    expect(threads).toContain("thread-b");
  });

  it("delete removes state and status", async () => {
    await cp.save(threadId, makeState(), "step1", "running");
    await cp.delete(threadId);
    expect(await cp.load(threadId)).toBeNull();
    expect(await cp.getStatus(threadId)).toBeNull();
  });

  it("load returns null for unknown threadId", async () => {
    expect(await cp.load("no-such-thread")).toBeNull();
  });

  it("different keyPrefixes are isolated", async () => {
    const cp2 = new Checkpointer<TestState>(cache, "other");
    await cp.save(threadId, makeState({ payload: "from-test" }), "step1", "running");
    expect(await cp2.load(threadId)).toBeNull();
  });
});
