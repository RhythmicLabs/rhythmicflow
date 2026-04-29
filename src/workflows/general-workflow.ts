import { type EventCache, type EventBus } from "@rhythmiclab/rhythmic-events";

import { BaseWorkflow } from "./base-workflow.js";
import { Checkpointer } from "../types/checkpointer.js";
import { WorkflowPubSub } from "../state/pubsub.js";
import {
  BaseWorkflowStatus,
  WorkflowContext,
  WorkflowResult,
  StepHandler,
} from "../types/workflow.js";
import {
  GeneralWorkflowState,
  GeneralWorkflowConfig,
} from "../types/workflow-states.js";

export class GeneralWorkflow<
  TState extends Record<string, unknown>,
  TStep extends string,
> extends BaseWorkflow<GeneralWorkflowState<TState, TStep>, TStep> {
  protected readonly steps: TStep[];
  protected readonly handlers: Record<
    TStep,
    StepHandler<GeneralWorkflowState<TState, TStep>>
  >;
  protected readonly initialStep: TStep;
  protected readonly terminalSteps: TStep[];
  protected readonly channelPrefix: string;

  private readonly config: GeneralWorkflowConfig<TState, TStep>;

  constructor(
    config: GeneralWorkflowConfig<TState, TStep>,
    eventCache: EventCache,
    eventBus: EventBus,
  ) {
    super(
      new Checkpointer<GeneralWorkflowState<TState, TStep>>(
        eventCache,
        config.channelPrefix ?? "general",
      ),
      new WorkflowPubSub(eventBus),
    );

    this.config = config;
    this.steps = config.steps;
    this.handlers = config.handlers;
    this.initialStep = config.initialStep;
    this.terminalSteps = config.terminalSteps;
    this.channelPrefix = config.channelPrefix ?? "general";
  }

  async run(
    context: WorkflowContext,
  ): Promise<WorkflowResult<GeneralWorkflowState<TState, TStep>>> {
    const initialState: GeneralWorkflowState<TState, TStep> = {
      data: this.config.initialData,
      currentStep: this.initialStep,
      stepHistory: [],
      status: BaseWorkflowStatus.PENDING,
      retryCount: 0,
      maxRetries: this.config.maxRetries ?? 3,
      startTime: new Date().toISOString(),
    };

    return this.execute(initialState, context);
  }
}

/**
 * Fluent builder for GeneralWorkflow — avoids spelling out the full config object.
 *
 * @example
 * const workflow = new WorkflowBuilder<{ count: number }, "start" | "process" | "done">()
 *   .steps(["start", "process", "done"])
 *   .initialStep("start")
 *   .terminalSteps(["done"])
 *   .handle("start", async state => ({ ...state, data: { count: 0 } }))
 *   .handle("process", async state => ({ ...state, data: { count: state.data.count + 1 } }))
 *   .handle("done", async state => state)
 *   .withData({ count: 0 })
 *   .build(eventCache, eventBus);
 */
export class WorkflowBuilder<
  TState extends Record<string, unknown>,
  TStep extends string,
> {
  private cfg: Partial<GeneralWorkflowConfig<TState, TStep>> = {};

  steps(steps: TStep[]): this {
    this.cfg.steps = steps;
    return this;
  }

  initialStep(step: TStep): this {
    this.cfg.initialStep = step;
    return this;
  }

  terminalSteps(steps: TStep[]): this {
    this.cfg.terminalSteps = steps;
    return this;
  }

  handle(
    step: TStep,
    handler: StepHandler<GeneralWorkflowState<TState, TStep>>,
  ): this {
    if (!this.cfg.handlers) {
      this.cfg.handlers = {} as Record<
        TStep,
        StepHandler<GeneralWorkflowState<TState, TStep>>
      >;
    }
    this.cfg.handlers[step] = handler;
    return this;
  }

  withData(initialData: TState): this {
    this.cfg.initialData = initialData;
    return this;
  }

  withChannelPrefix(prefix: string): this {
    this.cfg.channelPrefix = prefix;
    return this;
  }

  withMaxRetries(maxRetries: number): this {
    this.cfg.maxRetries = maxRetries;
    return this;
  }

  build(
    eventCache: EventCache,
    eventBus: EventBus,
  ): GeneralWorkflow<TState, TStep> {
    const required = [
      "steps",
      "initialStep",
      "terminalSteps",
      "handlers",
      "initialData",
    ] as const;
    for (const key of required) {
      if (this.cfg[key] === undefined) {
        throw new Error(`WorkflowBuilder: missing required config "${key}"`);
      }
    }
    return new GeneralWorkflow<TState, TStep>(
      this.cfg as GeneralWorkflowConfig<TState, TStep>,
      eventCache,
      eventBus,
    );
  }
}
