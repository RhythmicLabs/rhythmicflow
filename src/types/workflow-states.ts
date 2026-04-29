import {
  BaseWorkflowState,
  BaseWorkflowStatus,
  StepHandler,
  WorkflowContext,
} from "./workflow.js";
import { ModelProvider } from "./enums.js";
import { LLMProviderOptions } from "../llm/providers.js";

// ─── LLM Workflow ──────────────────────────────────────────────────────────────

export enum LLMWorkflowStep {
  PREPARING = "preparing",
  BUILDING_CONTEXT = "building_context",
  CALLING_LLM = "calling_llm",
  PARSING_RESPONSE = "parsing_response",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface LLMWorkflowState<T = unknown> extends BaseWorkflowState<
  LLMWorkflowStep,
  BaseWorkflowStatus
> {
  systemPrompt: string;
  userPrompt: string;
  rawResponse?: string;
  result?: T;
  contextData?: string;
  modelProvider: ModelProvider;
  modelName: string;
}

export interface LLMWorkflowConfig<T = unknown> {
  systemPrompt: string | (() => string);
  buildContext?: (state: LLMWorkflowState<T>) => Promise<string>;
  parseResponse?: (text: string) => Promise<T>;
  onComplete?: (result: T, state: LLMWorkflowState<T>) => Promise<void>;
  modelProvider?: ModelProvider;
  modelName?: string;
  maxRetries?: number;
  llmProviderOptions?: LLMProviderOptions;
}

// ─── Data Ingestion Workflow ───────────────────────────────────────────────────

export enum DataIngestionStep {
  DISCOVERING_SOURCES = "discovering_sources",
  FETCHING_DATA = "fetching_data",
  TRANSFORMING = "transforming",
  VALIDATING = "validating",
  LOADING = "loading",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface DataValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  recordCount: number;
}

export interface DataLoadResult {
  loaded: number;
  failed: number;
  duration: number;
}

export interface DataIngestionState<
  Source = unknown,
  RawData = unknown,
  ProcessedData = unknown,
> extends BaseWorkflowState<DataIngestionStep, BaseWorkflowStatus> {
  sources: Source[];
  rawData: RawData[];
  processedData: ProcessedData[];
  validationResult?: DataValidationResult;
  loadResult?: DataLoadResult;
}

export interface DataIngestionConfig<
  Source = unknown,
  RawData = unknown,
  ProcessedData = unknown,
> {
  discover?: () => Promise<Source[]>;
  fetch: (sources: Source[]) => Promise<RawData[]>;
  transform: (data: RawData[]) => Promise<ProcessedData[]>;
  validate?: (data: ProcessedData[]) => Promise<DataValidationResult>;
  load: (data: ProcessedData[]) => Promise<DataLoadResult>;
  maxRetries?: number;
  loadOnValidationError?: boolean;
}

// ─── General Workflow ──────────────────────────────────────────────────────────

export interface GeneralWorkflowState<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TStep extends string = string,
> extends BaseWorkflowState<TStep, BaseWorkflowStatus> {
  data: TState;
}

export interface GeneralWorkflowConfig<
  TState extends Record<string, unknown>,
  TStep extends string,
> {
  steps: TStep[];
  initialStep: TStep;
  terminalSteps: TStep[];
  handlers: Record<TStep, StepHandler<GeneralWorkflowState<TState, TStep>>>;
  initialData: TState;
  channelPrefix?: string;
  maxRetries?: number;
}

// ─── Scheduled Workflow ────────────────────────────────────────────────────────

export enum ScheduledWorkflowStep {
  INITIALIZING = "initializing",
  EXECUTING = "executing",
  COMPLETED = "completed",
}

/** Tick context handed to the user's execute / validate callbacks. */
export interface ScheduledTickContext<TPayload = unknown> {
  scheduleId: string;
  cronExpression: string;
  tickNumber: number;
  scheduledAt: string;
  payload?: TPayload;
}

export interface ScheduledWorkflowState<
  TPayload = unknown,
> extends BaseWorkflowState<ScheduledWorkflowStep, BaseWorkflowStatus> {
  scheduleId: string;
  cronExpression: string;
  tickNumber: number;
  scheduledAt: string;
  payload?: TPayload;
  result?: unknown;
}

export interface ScheduledWorkflowConfig<TPayload = unknown> {
  /** Called before execute; throw to abort the tick and transition to FAILED. */
  validate?: (tick: ScheduledTickContext<TPayload>) => Promise<void>;
  /** Main tick handler — return value is stored as state.result. */
  execute: (tick: ScheduledTickContext<TPayload>) => Promise<unknown>;
  /** Called on COMPLETED with the resolved result. */
  onComplete?: (
    result: unknown,
    state: ScheduledWorkflowState<TPayload>,
  ) => Promise<void>;
  /** Called on FAILED with the original error. */
  onError?: (
    error: Error,
    state: ScheduledWorkflowState<TPayload>,
  ) => Promise<void>;
  /** Override the WorkflowContext per tick (default: auto-generated from scheduleId + tickNumber). */
  contextFactory?: (tick: ScheduledTickContext<TPayload>) => WorkflowContext;
  maxRetries?: number;
  channelPrefix?: string;
}
