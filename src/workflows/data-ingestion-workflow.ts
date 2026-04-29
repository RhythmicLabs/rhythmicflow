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
  DataIngestionStep,
  DataIngestionState,
  DataIngestionConfig,
  DataValidationResult,
} from "../types/workflow-states.js";

export class DataIngestionWorkflow<
  Source = unknown,
  RawData = unknown,
  ProcessedData = unknown,
> extends BaseWorkflow<
  DataIngestionState<Source, RawData, ProcessedData>,
  DataIngestionStep
> {
  protected readonly steps: DataIngestionStep[] = [
    DataIngestionStep.DISCOVERING_SOURCES,
    DataIngestionStep.FETCHING_DATA,
    DataIngestionStep.TRANSFORMING,
    DataIngestionStep.VALIDATING,
    DataIngestionStep.LOADING,
    DataIngestionStep.COMPLETED,
  ];

  protected readonly handlers: Record<
    DataIngestionStep,
    StepHandler<DataIngestionState<Source, RawData, ProcessedData>>
  > = {
    [DataIngestionStep.DISCOVERING_SOURCES]:
      this.handleDiscoveringSources.bind(this),
    [DataIngestionStep.FETCHING_DATA]: this.handleFetchingData.bind(this),
    [DataIngestionStep.TRANSFORMING]: this.handleTransforming.bind(this),
    [DataIngestionStep.VALIDATING]: this.handleValidating.bind(this),
    [DataIngestionStep.LOADING]: this.handleLoading.bind(this),
    [DataIngestionStep.COMPLETED]: this.handleCompleted.bind(this),
    [DataIngestionStep.FAILED]: this.handleFailed.bind(this),
  };

  protected readonly initialStep = DataIngestionStep.DISCOVERING_SOURCES;
  protected readonly terminalSteps = [
    DataIngestionStep.COMPLETED,
    DataIngestionStep.FAILED,
  ];
  protected readonly channelPrefix = "data-ingestion";

  constructor(
    private readonly config: DataIngestionConfig<
      Source,
      RawData,
      ProcessedData
    >,
    eventCache: EventCache,
    eventBus: EventBus,
  ) {
    super(
      new Checkpointer<DataIngestionState<Source, RawData, ProcessedData>>(
        eventCache,
        "data-ingestion",
      ),
      new WorkflowPubSub(eventBus),
    );
  }

  async run(
    context: WorkflowContext,
  ): Promise<
    WorkflowResult<DataIngestionState<Source, RawData, ProcessedData>>
  > {
    const initialState: DataIngestionState<Source, RawData, ProcessedData> = {
      sources: [],
      rawData: [],
      processedData: [],
      currentStep: DataIngestionStep.DISCOVERING_SOURCES,
      stepHistory: [],
      status: BaseWorkflowStatus.PENDING,
      retryCount: 0,
      maxRetries: this.config.maxRetries ?? 3,
      startTime: new Date().toISOString(),
    };

    return this.execute(initialState, context);
  }

  protected override shouldContinue(
    state: DataIngestionState<Source, RawData, ProcessedData>,
  ): boolean {
    if (this.terminalSteps.includes(state.currentStep)) return false;

    if (
      state.currentStep === DataIngestionStep.VALIDATING &&
      state.validationResult &&
      !state.validationResult.valid &&
      !this.config.loadOnValidationError
    ) {
      return false;
    }

    return true;
  }

  private async handleDiscoveringSources(
    state: DataIngestionState<Source, RawData, ProcessedData>,
  ): Promise<DataIngestionState<Source, RawData, ProcessedData>> {
    const sources = this.config.discover ? await this.config.discover() : [];
    return { ...state, sources };
  }

  private async handleFetchingData(
    state: DataIngestionState<Source, RawData, ProcessedData>,
  ): Promise<DataIngestionState<Source, RawData, ProcessedData>> {
    const rawData = await this.config.fetch(state.sources);
    return { ...state, rawData };
  }

  private async handleTransforming(
    state: DataIngestionState<Source, RawData, ProcessedData>,
  ): Promise<DataIngestionState<Source, RawData, ProcessedData>> {
    const processedData = await this.config.transform(state.rawData);
    return { ...state, processedData };
  }

  private async handleValidating(
    state: DataIngestionState<Source, RawData, ProcessedData>,
  ): Promise<DataIngestionState<Source, RawData, ProcessedData>> {
    if (!this.config.validate) {
      const passResult: DataValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        recordCount: state.processedData.length,
      };
      return { ...state, validationResult: passResult };
    }

    const validationResult = await this.config.validate(state.processedData);
    return { ...state, validationResult };
  }

  private async handleLoading(
    state: DataIngestionState<Source, RawData, ProcessedData>,
  ): Promise<DataIngestionState<Source, RawData, ProcessedData>> {
    const start = Date.now();
    const loadResult = await this.config.load(state.processedData);
    return {
      ...state,
      loadResult: {
        ...loadResult,
        duration: loadResult.duration || Date.now() - start,
      },
    };
  }

  private async handleCompleted(
    state: DataIngestionState<Source, RawData, ProcessedData>,
  ): Promise<DataIngestionState<Source, RawData, ProcessedData>> {
    return state;
  }

  private async handleFailed(
    state: DataIngestionState<Source, RawData, ProcessedData>,
  ): Promise<DataIngestionState<Source, RawData, ProcessedData>> {
    return state;
  }
}

export function createDataIngestionWorkflow<
  S = unknown,
  R = unknown,
  P = unknown,
>(
  config: DataIngestionConfig<S, R, P>,
  eventCache: EventCache,
  eventBus: EventBus,
): DataIngestionWorkflow<S, R, P> {
  return new DataIngestionWorkflow<S, R, P>(config, eventCache, eventBus);
}
