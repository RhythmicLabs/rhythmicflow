import { v4 as uuidv4 } from "uuid";
import { DomainEvent } from "@rhythmiclab/rhythmic-events";

interface WorkflowStartedData<TContext = unknown> {
  workflowId: string;
  workflowType: string;
  context: TContext;
  metadata?: Record<string, unknown>;
}

interface WorkflowProgressData {
  workflowId: string;
  step: string;
  stepIndex: number;
  totalSteps: number;
  message?: string;
}

interface WorkflowCompletedData<TResult = unknown> {
  workflowId: string;
  result: TResult;
  duration: number;
}

interface WorkflowFailedData {
  workflowId: string;
  error: string;
  step?: string;
  retryable: boolean;
}

interface WorkflowStepStartedData {
  workflowId: string;
  step: string;
}

interface WorkflowStepCompletedData {
  workflowId: string;
  step: string;
  duration: number;
}

export class WorkflowStartedEvent<TContext = unknown> extends DomainEvent<
  WorkflowStartedData<TContext>
> {
  constructor(
    workflowId: string,
    workflowType: string,
    context: TContext,
    metadata?: Record<string, unknown>,
  ) {
    super(
      "workflow.started",
      uuidv4(),
      { workflowId, workflowType, context, metadata },
      workflowId,
    );
  }
}

export class WorkflowProgressEvent extends DomainEvent<WorkflowProgressData> {
  constructor(
    workflowId: string,
    step: string,
    stepIndex: number,
    totalSteps: number,
    message?: string,
  ) {
    super(
      "workflow.progress",
      uuidv4(),
      { workflowId, step, stepIndex, totalSteps, message },
      workflowId,
    );
  }
}

export class WorkflowCompletedEvent<TResult = unknown> extends DomainEvent<
  WorkflowCompletedData<TResult>
> {
  constructor(workflowId: string, result: TResult, duration: number) {
    super(
      "workflow.completed",
      uuidv4(),
      { workflowId, result, duration },
      workflowId,
    );
  }
}

export class WorkflowFailedEvent extends DomainEvent<WorkflowFailedData> {
  constructor(
    workflowId: string,
    error: string,
    retryable: boolean,
    step?: string,
  ) {
    super(
      "workflow.failed",
      uuidv4(),
      { workflowId, error, step, retryable },
      workflowId,
    );
  }
}

export class WorkflowStepStartedEvent extends DomainEvent<WorkflowStepStartedData> {
  constructor(workflowId: string, step: string) {
    super("workflow.step.started", uuidv4(), { workflowId, step }, workflowId);
  }
}

export class WorkflowStepCompletedEvent extends DomainEvent<WorkflowStepCompletedData> {
  constructor(workflowId: string, step: string, duration: number) {
    super(
      "workflow.step.completed",
      uuidv4(),
      { workflowId, step, duration },
      workflowId,
    );
  }
}
