import { describe, it, expect, beforeEach } from "bun:test";
import { EventCache, EventBus } from "@rhythmiclab/rhythmic-events";
import { ScheduledWorkflowEngine } from "../scheduled-workflow.js";
import type { ScheduledTickContext } from "../../types/workflow-states.js";

describe("ScheduledWorkflowEngine", () => {
  let cache: EventCache;
  let bus: EventBus;
  let engine: ScheduledWorkflowEngine;

  beforeEach(() => {
    cache  = new EventCache({ maxSize: 100, ttl: 60_000 });
    bus    = new EventBus({ enableCache: false });
    engine = new ScheduledWorkflowEngine(bus, cache);
  });

  it("calls execute on each tick and stores result in state", async () => {
    const results: unknown[] = [];

    const scheduleId = await engine.schedule(
      { cronExpression: "* * * * * *", maxTicks: 2, startImmediately: true },
      {
        execute: async (tick: ScheduledTickContext) => {
          const result = `tick-${tick.tickNumber}`;
          results.push(result);
          return result;
        },
      },
    );

    // startImmediately fires tick 1 synchronously; tick 2 fires at next second boundary.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    engine.cleanup();

    expect(scheduleId).toBeTruthy();
    expect(results.length).toBe(2);
    expect(results[0]).toBe("tick-1");
    expect(results[1]).toBe("tick-2");
  }, 10_000);

  it("calls validate before execute and skips execute on validation failure", async () => {
    const executed: number[] = [];

    await engine.schedule(
      { cronExpression: "* * * * * *", maxTicks: 2, startImmediately: true },
      {
        validate: async (tick: ScheduledTickContext) => {
          if (tick.tickNumber === 1) throw new Error("rejected tick 1");
        },
        execute: async (tick: ScheduledTickContext) => {
          executed.push(tick.tickNumber);
          return tick.tickNumber;
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 3000));
    engine.cleanup();

    // tick 1 fails validation → execute never called for tick 1
    // tick 2 passes validation → execute called
    expect(executed).not.toContain(1);
    expect(executed).toContain(2);
  }, 10_000);

  it("calls onComplete callback with the result", async () => {
    const completed: Array<{ result: unknown; tickNumber: number }> = [];

    await engine.schedule(
      { cronExpression: "* * * * * *", maxTicks: 1, startImmediately: true },
      {
        execute: async (tick: ScheduledTickContext) => `done-${tick.tickNumber}`,
        onComplete: async (result, state) => {
          completed.push({ result, tickNumber: state.tickNumber });
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));
    engine.cleanup();

    expect(completed).toHaveLength(1);
    expect(completed[0].result).toBe("done-1");
    expect(completed[0].tickNumber).toBe(1);
  }, 10_000);

  it("calls onError when execute throws", async () => {
    const errors: string[] = [];

    await engine.schedule(
      { cronExpression: "* * * * * *", maxTicks: 1, startImmediately: true },
      {
        execute: async () => { throw new Error("boom"); },
        onError: async (err) => { errors.push(err.message); },
        maxRetries: 0,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));
    engine.cleanup();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe("boom");
  }, 10_000);

  it("uses contextFactory to build WorkflowContext per tick", async () => {
    const threadIds: string[] = [];

    await engine.schedule(
      { cronExpression: "* * * * * *", maxTicks: 1, startImmediately: true },
      {
        execute: async () => "ok",
        contextFactory: (tick) => ({
          threadId: `custom:${tick.scheduleId}:${tick.tickNumber}`,
          jobId:    "custom-job",
          userId:   "custom-user",
        }),
        onComplete: async (_result, state) => {
          threadIds.push(`custom:${state.scheduleId}:${state.tickNumber}`);
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));
    engine.cleanup();

    expect(threadIds[0]).toMatch(/^custom:/);
  }, 10_000);

  it("passes payload through to execute", async () => {
    const received: string[] = [];

    await engine.schedule<string>(
      {
        cronExpression:   "* * * * * *",
        maxTicks:         1,
        startImmediately: true,
        payload:          "hello-payload",
      },
      {
        execute: async (tick) => {
          received.push(tick.payload ?? "missing");
          return tick.payload;
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));
    engine.cleanup();

    expect(received[0]).toBe("hello-payload");
  }, 10_000);

  it("stop and start control tick delivery", async () => {
    const ticks: number[] = [];

    const scheduleId = await engine.schedule(
      { cronExpression: "* * * * * *", maxTicks: 5, startImmediately: true },
      {
        execute: async (tick) => { ticks.push(tick.tickNumber); },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));
    engine.stop(scheduleId);
    const countAfterStop = ticks.length;

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(ticks.length).toBe(countAfterStop);

    engine.start(scheduleId);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    engine.cleanup();

    expect(ticks.length).toBeGreaterThan(countAfterStop);
  }, 15_000);

  it("unschedule removes the schedule and stops future ticks", async () => {
    const ticks: number[] = [];

    const scheduleId = await engine.schedule(
      { cronExpression: "* * * * * *", maxTicks: 5, startImmediately: true },
      {
        execute: async (tick) => { ticks.push(tick.tickNumber); },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const removed = engine.unschedule(scheduleId);
    const countAtRemoval = ticks.length;

    await new Promise((resolve) => setTimeout(resolve, 1500));
    engine.cleanup();

    expect(removed).toBe(true);
    expect(ticks.length).toBe(countAtRemoval);
  }, 10_000);

  it("listSchedules reflects registered schedules", async () => {
    const id1 = await engine.schedule(
      { cronExpression: "*/5 * * * *", scheduleId: "sched-a" },
      { execute: async () => {} },
    );
    const id2 = await engine.schedule(
      { cronExpression: "0 * * * *", scheduleId: "sched-b" },
      { execute: async () => {} },
    );

    const list = engine.listSchedules();
    const ids  = list.map((s) => s.scheduleId);

    expect(ids).toContain(id1);
    expect(ids).toContain(id2);

    engine.cleanup();
  });
});
