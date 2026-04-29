import { generateText } from "ai";
import { type EventCache, type EventBus } from "@rhythmiclab/rhythmic-events";

import { BaseWorkflow } from "./base-workflow.js";
import { Checkpointer } from "../types/checkpointer.js";
import { WorkflowPubSub } from "../state/pubsub.js";
import {
  BaseWorkflowStatus,
  WorkflowContext,
  WorkflowResult,
} from "../types/workflow.js";
import {
  LLMWorkflowStep,
  LLMWorkflowState,
  LLMWorkflowConfig,
} from "../types/workflow-states.js";
import { ModelProvider, ModelName } from "../types/enums.js";
import { LLMProviderFactory } from "../llm/providers.js";
import { StepHandler } from "../types/workflow.js";

export class LLMWorkflow<T = string> extends BaseWorkflow<
  LLMWorkflowState<T>,
  LLMWorkflowStep
> {
  protected readonly steps: LLMWorkflowStep[] = [
    LLMWorkflowStep.PREPARING,
    LLMWorkflowStep.BUILDING_CONTEXT,
    LLMWorkflowStep.CALLING_LLM,
    LLMWorkflowStep.PARSING_RESPONSE,
    LLMWorkflowStep.COMPLETED,
  ];

  protected readonly handlers: Record<
    LLMWorkflowStep,
    StepHandler<LLMWorkflowState<T>>
  > = {
    [LLMWorkflowStep.PREPARING]: this.handlePreparing.bind(this),
    [LLMWorkflowStep.BUILDING_CONTEXT]: this.handleBuildingContext.bind(this),
    [LLMWorkflowStep.CALLING_LLM]: this.handleCallingLLM.bind(this),
    [LLMWorkflowStep.PARSING_RESPONSE]: this.handleParsingResponse.bind(this),
    [LLMWorkflowStep.COMPLETED]: this.handleCompleted.bind(this),
    [LLMWorkflowStep.FAILED]: this.handleFailed.bind(this),
  };

  protected readonly initialStep = LLMWorkflowStep.PREPARING;
  protected readonly terminalSteps = [
    LLMWorkflowStep.COMPLETED,
    LLMWorkflowStep.FAILED,
  ];
  protected readonly channelPrefix = "llm";

  constructor(
    private readonly config: LLMWorkflowConfig<T>,
    eventCache: EventCache,
    eventBus: EventBus,
  ) {
    super(
      new Checkpointer<LLMWorkflowState<T>>(eventCache, "llm"),
      new WorkflowPubSub(eventBus),
    );

    if (config.llmProviderOptions) {
      LLMProviderFactory.configure(config.llmProviderOptions);
    }
  }

  async run(
    userPrompt: string,
    context: WorkflowContext,
  ): Promise<WorkflowResult<LLMWorkflowState<T>>> {
    const provider = this.config.modelProvider ?? ModelProvider.claude;
    const modelName = this.config.modelName ?? ModelName.CLAUDE_SONNET;

    const initialState: LLMWorkflowState<T> = {
      systemPrompt: "",
      userPrompt,
      modelProvider: provider,
      modelName,
      currentStep: LLMWorkflowStep.PREPARING,
      stepHistory: [],
      status: BaseWorkflowStatus.PENDING,
      retryCount: 0,
      maxRetries: this.config.maxRetries ?? 3,
      startTime: new Date().toISOString(),
    };

    return this.execute(initialState, context);
  }

  private async handlePreparing(
    state: LLMWorkflowState<T>,
  ): Promise<LLMWorkflowState<T>> {
    const systemPrompt =
      typeof this.config.systemPrompt === "function"
        ? this.config.systemPrompt()
        : this.config.systemPrompt;

    return { ...state, systemPrompt };
  }

  private async handleBuildingContext(
    state: LLMWorkflowState<T>,
  ): Promise<LLMWorkflowState<T>> {
    if (!this.config.buildContext) return state;

    const contextData = await this.config.buildContext(state);
    return { ...state, contextData };
  }

  private async handleCallingLLM(
    state: LLMWorkflowState<T>,
  ): Promise<LLMWorkflowState<T>> {
    const model = LLMProviderFactory.getLanguageModel(
      state.modelProvider,
      state.modelName,
    );

    const prompt = state.contextData
      ? `${state.userPrompt}\n\nAdditional context:\n${state.contextData}`
      : state.userPrompt;

    const { text } = await generateText({
      model,
      system: state.systemPrompt,
      prompt,
    });

    return { ...state, rawResponse: text };
  }

  private async handleParsingResponse(
    state: LLMWorkflowState<T>,
  ): Promise<LLMWorkflowState<T>> {
    const raw = state.rawResponse ?? "";

    const result = this.config.parseResponse
      ? await this.config.parseResponse(raw)
      : (raw as unknown as T);

    return { ...state, result };
  }

  private async handleCompleted(
    state: LLMWorkflowState<T>,
  ): Promise<LLMWorkflowState<T>> {
    if (this.config.onComplete && state.result !== undefined) {
      await this.config.onComplete(state.result, state);
    }
    return state;
  }

  private async handleFailed(
    state: LLMWorkflowState<T>,
  ): Promise<LLMWorkflowState<T>> {
    return state;
  }
}

export function createLLMWorkflow<T = string>(
  config: LLMWorkflowConfig<T>,
  eventCache: EventCache,
  eventBus: EventBus,
): LLMWorkflow<T> {
  return new LLMWorkflow<T>(config, eventCache, eventBus);
}
