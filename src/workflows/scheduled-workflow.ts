import { v4 as uuidv4 } from "uuid";
import {
  type EventCache,
  type EventBus,
  type ScheduleDescriptor,
  type ScheduleEntry,
  ScheduledEvent,
  ScheduledEventManager,
} from "@rhythmiclab/rhythmic-events";

import { BaseWorkflow } from "./base-workflow.js";
import { Checkpointer } from "../types/checkpointer.js";
import { WorkflowPubSub } from "../state/pubsub.js";
import {
  BaseWorkflowStatus,
  type StepHandler,
  type WorkflowContext,
  type WorkflowResult,
} from "../types/workflow.js";
import {
  ScheduledWorkflowStep,
  type ScheduledWorkflowState,
  type ScheduledWorkflowConfig,
  type ScheduledTickContext,
} from "../types/workflow-states.js";

// ── Per-tick workflow ──────────────────────────────────────────────────────────

export class ScheduledWorkflow<TPayload = unknown> extends BaseWorkflow<
  ScheduledWorkflowState<TPayload>,
  ScheduledWorkflowStep
> {
  protected readonly steps: ScheduledWorkflowStep[] = [
    ScheduledWorkflowStep.INITIALIZING,
    ScheduledWorkflowStep.EXECUTING,
    ScheduledWorkflowStep.COMPLETED,
  ];

  protected readonly handlers: Record<
    ScheduledWorkflowStep,
    StepHandler<ScheduledWorkflowState<TPayload>>
  > = {
    [ScheduledWorkflowStep.INITIALIZING]: this.handleInitializing.bind(this),
    [ScheduledWorkflowStep.EXECUTING]: this.handleExecuting.bind(this),
    // handleCompleted is never invoked by BaseWorkflow (terminal step short-circuits
    // before calling the handler), but must exist to satisfy Record<Step, Handler>.
    [ScheduledWorkflowStep.COMPLETED]: (state) => Promise.resolve(state),
  };

  protected readonly initialStep = ScheduledWorkflowStep.INITIALIZING;
  protected readonly terminalSteps = [ScheduledWorkflowStep.COMPLETED];
  protected readonly channelPrefix: string;

  constructor(
    private readonly tickData: ScheduledTickContext<TPayload>,
    private readonly config: ScheduledWorkflowConfig<TPayload>,
    eventCache: EventCache,
    eventBus: EventBus,
  ) {
    super(
      new Checkpointer<ScheduledWorkflowState<TPayload>>(
        eventCache,
        config.channelPrefix ?? "scheduled",
      ),
      new WorkflowPubSub(eventBus),
    );
    this.channelPrefix = config.channelPrefix ?? "scheduled";
  }

  async run(
    context: WorkflowContext,
  ): Promise<WorkflowResult<ScheduledWorkflowState<TPayload>>> {
    const initialState: ScheduledWorkflowState<TPayload> = {
      scheduleId: this.tickData.scheduleId,
      cronExpression: this.tickData.cronExpression,
      tickNumber: this.tickData.tickNumber,
      scheduledAt: this.tickData.scheduledAt,
      payload: this.tickData.payload,
      currentStep: ScheduledWorkflowStep.INITIALIZING,
      stepHistory: [],
      status: BaseWorkflowStatus.PENDING,
      retryCount: 0,
      maxRetries: this.config.maxRetries ?? 0,
      startTime: new Date().toISOString(),
    };
    return this.execute(initialState, context);
  }

  private tickContext(
    state: ScheduledWorkflowState<TPayload>,
  ): ScheduledTickContext<TPayload> {
    return {
      scheduleId: state.scheduleId,
      cronExpression: state.cronExpression,
      tickNumber: state.tickNumber,
      scheduledAt: state.scheduledAt,
      payload: state.payload,
    };
  }

  private async handleInitializing(
    state: ScheduledWorkflowState<TPayload>,
  ): Promise<ScheduledWorkflowState<TPayload>> {
    if (this.config.validate) {
      await this.config.validate(this.tickContext(state));
    }
    return { ...state, currentStep: ScheduledWorkflowStep.EXECUTING };
  }

  private async handleExecuting(
    state: ScheduledWorkflowState<TPayload>,
  ): Promise<ScheduledWorkflowState<TPayload>> {
    try {
      const result = await this.config.execute(this.tickContext(state));
      // onComplete is called here because BaseWorkflow short-circuits on terminal
      // steps — the COMPLETED step handler is never invoked by the execution engine.
      await this.config.onComplete?.(result, { ...state, result });
      return { ...state, result, currentStep: ScheduledWorkflowStep.COMPLETED };
    } catch (error) {
      await this.config.onError?.(
        error instanceof Error ? error : new Error(String(error)),
        state,
      );
      throw error;
    }
  }
}

// ── Schedule orchestrator ──────────────────────────────────────────────────────

type RegistryEntry = {
  config: ScheduledWorkflowConfig<unknown>;
  subscriptionId: string;
};

export class ScheduledWorkflowEngine {
  private readonly manager: ScheduledEventManager;
  private readonly registry = new Map<string, RegistryEntry>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly eventCache: EventCache,
  ) {
    this.manager = new ScheduledEventManager(eventBus);
  }

  async schedule<TPayload>(
    descriptor: ScheduleDescriptor<TPayload>,
    config: ScheduledWorkflowConfig<TPayload>,
  ): Promise<string> {
    // Generate the scheduleId before subscribing so that we can filter by it.
    // We subscribe BEFORE calling manager.schedule() because startImmediately
    // fires the first tick synchronously inside manager.schedule() via
    // job.trigger() — subscribing after would miss that tick.
    const scheduleId = descriptor.scheduleId ?? uuidv4();
    const descriptorWithId: ScheduleDescriptor<TPayload> = {
      ...descriptor,
      scheduleId,
    };

    const subscriptionId = this.eventBus.subscribe(
      ScheduledEvent.EVENT_TYPE,
      async (raw: unknown) => {
        const event = raw as ScheduledEvent<TPayload>;
        if (event.scheduleId !== scheduleId) return;
        await this.runTick(scheduleId, event, config);
      },
    );

    this.registry.set(scheduleId, {
      config: config as ScheduledWorkflowConfig<unknown>,
      subscriptionId,
    });

    await this.manager.schedule(descriptorWithId);
    return scheduleId;
  }

  unschedule(scheduleId: string): boolean {
    const entry = this.registry.get(scheduleId);
    if (!entry) return false;
    this.eventBus.unsubscribe(entry.subscriptionId);
    this.registry.delete(scheduleId);
    return this.manager.unschedule(scheduleId);
  }

  stop(scheduleId: string): boolean {
    return this.manager.stop(scheduleId);
  }

  start(scheduleId: string): boolean {
    return this.manager.start(scheduleId);
  }

  listSchedules(): ScheduleEntry[] {
    return this.manager.listSchedules();
  }

  cleanup(): void {
    for (const { subscriptionId } of this.registry.values()) {
      this.eventBus.unsubscribe(subscriptionId);
    }
    this.registry.clear();
    this.manager.cleanup();
  }

  private async runTick<TPayload>(
    scheduleId: string,
    event: ScheduledEvent<TPayload>,
    config: ScheduledWorkflowConfig<TPayload>,
  ): Promise<void> {
    const tick: ScheduledTickContext<TPayload> = {
      scheduleId,
      cronExpression: event.cronExpression,
      tickNumber: event.tickNumber,
      scheduledAt: event.scheduledAt.toISOString(),
      payload: event.payload,
    };

    const context: WorkflowContext = config.contextFactory?.(tick) ?? {
      threadId: `${scheduleId}:tick:${event.tickNumber}`,
      jobId: scheduleId,
      userId: "scheduler",
    };

    const workflow = new ScheduledWorkflow<TPayload>(
      tick,
      config,
      this.eventCache,
      this.eventBus,
    );
    await workflow.run(context);
  }
}

export function createScheduledWorkflowEngine(
  eventBus: EventBus,
  eventCache: EventCache,
): ScheduledWorkflowEngine {
  return new ScheduledWorkflowEngine(eventBus, eventCache);
}
