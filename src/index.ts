/**
 * Public API surface of @rhythmiclab/rhythmicflow.
 *
 * Import from this barrel rather than from internal sub-paths so that
 * internal refactors don't break callers.
 *
 * Exports: WorkflowEngine, generic workflow archetypes (LLM, DataIngestion,
 * General, MCP), state machine base, LLM providers, RAG services, events,
 * and type definitions.
 */

// Core engine
export { WorkflowEngine, WorkflowEngineConfig } from './core.js';

// Base workflow types and classes
export type { BaseWorkflowState, BaseWorkflowStatus, StepHandler, WorkflowResult, WorkflowContext } from './types/workflow.js';
export { BaseWorkflow } from './workflows/base-workflow.js';

// Workflow event types
export type { WorkflowEvent } from './types/workflow.js';

// Checkpointer and pub/sub
export { Checkpointer } from './types/checkpointer.js';
export { WorkflowPubSub } from './state/pubsub.js';
export { StateManager } from './state/manager.js';

// LLM providers
export { LLMProviderFactory } from './llm/providers.js';
export type { LanguageModel } from './llm/providers.js';
export { ModelProvider, ModelName, VALID_MODELS, DEFAULT_MODEL } from './types/enums.js';

// RAG services
export { EmbeddingsService } from './rag/embeddings.js';
export { RagContextService } from './rag/context.js';

// Prompt utilities
export { processUserContext, ProcessedContext } from './prompts/context-utils.js';

// LLM Workflow
export type { LLMWorkflowStep, LLMWorkflowState, LLMWorkflowConfig } from './types/workflow-states.js';
export { createLLMWorkflow } from './workflows/llm-workflow.js';

// Data Ingestion Workflow
export type { DataIngestionStep, DataIngestionState, DataIngestionConfig, DataValidationResult, DataLoadResult } from './types/workflow-states.js';
export { createDataIngestionWorkflow } from './workflows/data-ingestion-workflow.js';

// General Workflow
export type { GeneralWorkflowState, GeneralWorkflowConfig } from './types/workflow-states.js';
export { GeneralWorkflow, WorkflowBuilder } from './workflows/general-workflow.js';

// Events
export { WorkflowStartedEvent, WorkflowProgressEvent, WorkflowCompletedEvent, WorkflowFailedEvent, WorkflowStepStartedEvent, WorkflowStepCompletedEvent } from './events/workflow.js';

// MCP
export type { MCPToolHandler } from './workflows/mcp-workflow.js';
export { MCPWorkflow, MCPWorkflowStep, MCPWorkflowState } from './workflows/mcp-workflow.js';
export { MCPService } from './mcp/service.js';
export { MCPWebSocketServer } from './mcp/websocket-server.js';
export { ToolRegistry, ToolDefinition, createToolRegistry } from './mcp/tool-registry.js';
export { createMCPServer, handleUpgrade } from './mcp/websocket-handler.js';

// Scheduled Workflow
export type { ScheduledWorkflowStep, ScheduledWorkflowState, ScheduledWorkflowConfig, ScheduledTickContext } from './types/workflow-states.js';
export { ScheduledWorkflow, ScheduledWorkflowEngine, createScheduledWorkflowEngine } from './workflows/scheduled-workflow.js';

// Generic graph types
export type { GenericGraph, GenericNode, GenericEdge } from './types/graph.js';
