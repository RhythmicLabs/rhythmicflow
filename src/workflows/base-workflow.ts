/**
 * Abstract base workflow class for kubegram-core.
 *
 * Provides a reusable execution engine with:
 *   - Step-based state machine with linear (or overridable) progression
 *   - State checkpointing via RedisCheckpointer at each step
 *   - Retry logic (configurable per workflow)
 *   - Event publishing via WorkflowPubSub (backed by @kubegram/events EventBus)
 *
 * Ported from kuberag/src/workflows/base-workflow.ts
 * Dependencies replaced: PubSub → WorkflowPubSub, checkpointer import path updated.
 */

import { Checkpointer } from "../types/checkpointer.js";
import { WorkflowPubSub } from "../state/pubsub.js";
import {
  BaseWorkflowStatus,
  type BaseWorkflowState,
  type StepHandler,
  type WorkflowResult,
  type WorkflowContext,
  type WorkflowEvent,
} from "../types/workflow.js";

export abstract class BaseWorkflow<
  State extends BaseWorkflowState<Step, string>,
  Step extends string,
> {
  /** Ordered list of steps for linear progression */
  protected abstract readonly steps: Step[];

  /** Map of step name → handler function */
  protected abstract readonly handlers: Record<Step, StepHandler<State>>;

  /** First step to execute */
  protected abstract readonly initialStep: Step;

  /** Steps that signal the workflow is done (no further transitions) */
  protected abstract readonly terminalSteps: Step[];

  /** Channel prefix for pub/sub events (e.g. "codegen") */
  protected abstract readonly channelPrefix: string;

  constructor(
    protected readonly checkpointer: Checkpointer<State>,
    protected readonly pubsub: WorkflowPubSub,
  ) {}

  /**
   * Execute the workflow engine.
   * Call this from your subclass's public run() method after creating initial state.
   */
  protected async execute(
    initialState: State,
    context: WorkflowContext,
  ): Promise<WorkflowResult<State>> {
    const startTime = Date.now();

    try {
      let state: State = {
        ...initialState,
        status: BaseWorkflowStatus.RUNNING as State["status"],
      };

      await this.checkpoint(state, context);
      await this.publishEvent(context.threadId, {
        type: "started",
        workflowId: context.threadId,
        timestamp: new Date().toISOString(),
        metadata: { jobId: context.jobId },
      });

      state = await this.executeStep(state, context);

      const success =
        state.status === (BaseWorkflowStatus.COMPLETED as State["status"]);
      await this.checkpoint(state, context);
      await this.publishEvent(context.threadId, {
        type: success ? "completed" : "failed",
        workflowId: context.threadId,
        error: state.error,
        timestamp: new Date().toISOString(),
        metadata: { jobId: context.jobId },
      });

      return {
        state,
        success,
        error: state.error,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorState = this.finalizeState(initialState, false, errorMessage);

      await this.checkpoint(errorState, context);
      await this.publishEvent(context.threadId, {
        type: "failed",
        workflowId: context.threadId,
        error: errorMessage,
        timestamp: new Date().toISOString(),
        metadata: { jobId: context.jobId },
      });

      return {
        state: errorState,
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Recursive step execution with retry support.
   */
  private async executeStep(
    state: State,
    context: WorkflowContext,
  ): Promise<State> {
    const step = state.currentStep;

    await this.checkpoint(state, context);

    try {
      const handler = this.handlers[step];
      if (!handler) throw new Error(`No handler for step: ${step}`);

      state = await handler(state);

      if (this.shouldContinue(state)) {
        const nextStep = this.getNextStep(state, step);
        if (nextStep) {
          state = this.transitionTo(state, nextStep);
          return this.executeStep(state, context);
        }
      }

      return this.finalizeState(state, true);
    } catch (error) {
      console.error(`Step ${step} failed:`, error);

      state = this.onStepError(state, error);

      await this.publishEvent(context.threadId, {
        type: "step_failed",
        workflowId: context.threadId,
        step,
        error: state.error,
        timestamp: new Date().toISOString(),
        metadata: { jobId: context.jobId },
      });

      if (this.shouldRetry(state)) {
        console.info(`Retrying step ${step}, attempt ${state.retryCount + 1}`);
        state = { ...state, retryCount: state.retryCount + 1 };
        return this.executeStep(state, context);
      }

      return this.finalizeState(state, false, state.error);
    }
  }

  // --- Overridable hooks ---

  /** Whether the workflow should advance to the next step. Override for custom logic. */
  protected shouldContinue(state: State): boolean {
    return !this.terminalSteps.includes(state.currentStep);
  }

  /** Get the next step after currentStep. Default: linear progression through `steps` array. */
  protected getNextStep(_state: State, currentStep: Step): Step | null {
    const idx = this.steps.indexOf(currentStep);
    return idx >= 0 && idx < this.steps.length - 1 ? this.steps[idx + 1] : null;
  }

  protected injectStep(
    _state: State,
    currentStep: Step,
    injectedStep: Step,
  ): void {
    const idx = this.steps.indexOf(currentStep);
    if (idx >= 0 && idx < this.steps.length - 1) {
      this.steps.splice(idx + 1, 0, injectedStep);
    }
  }

  /** Whether to retry after a step failure. */
  protected shouldRetry(state: State): boolean {
    return state.retryCount < state.maxRetries;
  }

  /** Handle a step error. Override to add custom error handling. */
  protected onStepError(state: State, error: unknown): State {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { ...state, error: errorMessage, errorDetails: error };
  }

  // --- State helpers ---

  private transitionTo(state: State, step: Step): State {
    return {
      ...state,
      currentStep: step,
      stepHistory: [...state.stepHistory, state.currentStep],
      status: BaseWorkflowStatus.RUNNING as State["status"],
    };
  }

  private finalizeState(state: State, success: boolean, error?: string): State {
    const endTime = new Date().toISOString();
    return {
      ...state,
      status: (success
        ? BaseWorkflowStatus.COMPLETED
        : BaseWorkflowStatus.FAILED) as State["status"],
      endTime,
      duration:
        new Date(endTime).getTime() - new Date(state.startTime).getTime(),
      error: error ?? state.error,
    };
  }

  // --- Infrastructure helpers ---

  private async checkpoint(
    state: State,
    context: WorkflowContext,
  ): Promise<void> {
    await this.checkpointer.save(
      context.threadId,
      state,
      state.currentStep,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state.status as any,
    );
  }

  private async publishEvent(
    threadId: string,
    event: WorkflowEvent,
  ): Promise<void> {
    await this.pubsub.publish(`${this.channelPrefix}:${threadId}`, event);
  }

  // --- Public API ---

  async getStatus(threadId: string): Promise<State | null> {
    return this.checkpointer.load(threadId);
  }

  async cancel(threadId: string): Promise<boolean> {
    try {
      const state = await this.checkpointer.load(threadId);
      if (!state || this.isTerminalStatus(state.status)) return false;

      const cancelled: State = {
        ...this.finalizeState(state, false, "Workflow cancelled by user"),
        status: BaseWorkflowStatus.CANCELLED as State["status"],
      };
      await this.checkpointer.save(
        threadId,
        cancelled,
        state.currentStep,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        BaseWorkflowStatus.CANCELLED as any,
      );
      await this.publishEvent(threadId, {
        type: "cancelled",
        workflowId: threadId,
        timestamp: new Date().toISOString(),
      });

      return true;
    } catch (error) {
      console.error("Failed to cancel workflow:", error);
      return false;
    }
  }

  private isTerminalStatus(status: string): boolean {
    return (
      status === BaseWorkflowStatus.COMPLETED ||
      status === BaseWorkflowStatus.FAILED ||
      status === BaseWorkflowStatus.CANCELLED
    );
  }
}
