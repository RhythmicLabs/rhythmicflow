/**
 * Generic workflow framework types shared by BaseWorkflow and all concrete
 * workflow implementations.
 *
 * `BaseWorkflowState<Step, Status>` is the required state shape — all concrete
 * states (CodegenState, PlanState, ValidationState) must extend it. The state is
 * persisted to Redis between steps via RedisCheckpointer.
 *
 * `StepHandler<State>` is the unit of work per step — it receives the current
 * state and returns the updated state. Step handlers must be pure with respect
 * to external side effects (checkpoint + publish happen in BaseWorkflow.execute).
 *
 * `WorkflowContext` carries request-scoped identity (threadId, jobId, userId,
 * companyId) without being part of the persisted state. It is passed into
 * BaseWorkflow.execute() and available to all step handlers via closure.
 */

export enum BaseWorkflowStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export interface BaseWorkflowState<
  Step extends string = string,
  Status extends string = string,
> {
  currentStep: Step;
  stepHistory: Step[];
  status: Status;
  retryCount: number;
  maxRetries: number;
  startTime: string;
  endTime?: string;
  duration?: number;
  error?: string;
  errorDetails?: unknown;
}

export type StepHandler<State> = (state: State) => Promise<State>;

export interface WorkflowResult<State> {
  state: State;
  success: boolean;
  error?: string;
  duration: number;
}

export interface WorkflowOptions {
  maxRetries?: number;
  timeout?: number;
}

export interface WorkflowContext {
  threadId: string;
  jobId: string;
  userId: string;
  userContext?: string[];
}

export interface WorkflowEvent {
  type:
    | "started"
    | "step_started"
    | "step_completed"
    | "step_failed"
    | "completed"
    | "failed"
    | "cancelled";
  workflowId: string;
  step?: string;
  error?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
