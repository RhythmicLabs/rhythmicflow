# @rhythmiclab/rhythmicflow

[![npm version](https://badge.fury.io/js/@rythmiclabs%2Frythmicflow.svg)](https://www.npmjs.com/package/@rhythmiclab/rhythmicflow)
[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](LICENSE)
[![Build Status](https://github.com/shehats/rhythmic-workflows/actions/workflows/ci.yml/badge.svg)](https://github.com/shehats/rhythmic-workflows/actions)

Generic workflow library with LLM integration, MCP protocol support, cron-based scheduling, and state machine patterns.

## Installation

```bash
npm install @rhythmiclab/rhythmicflow
```

`@rhythmiclab/rhythmic-events` is a required peer dependency — install it alongside:

```bash
npm install @rhythmiclab/rhythmic-events
```

For cron-based scheduling (`ScheduledWorkflowEngine`) also install the optional `croner` peer:

```bash
npm install croner
```

## Quick Start

```typescript
import { WorkflowEngine, createLLMWorkflow } from '@rhythmiclab/rhythmicflow';
import { EventCache } from '@rhythmiclab/rhythmic-events';

// Initialize engine
const engine = new WorkflowEngine({ enableMcp: true });
await engine.initialize();

// Create shared services
const eventCache = new EventCache({ maxSize: 1000, ttl: 3600000 });
const eventBus = engine.eventBus;

// Create and run an LLM workflow
const workflow = createLLMWorkflow({
  systemPrompt: "You are a helpful assistant.",
  modelProvider: ModelProvider.claude,
  modelName: ModelName.CLAUDE_SONNET,
}, eventCache, eventBus);

const context = { threadId: "thread-1", jobId: "job-1", userId: "user-123" };
const result = await workflow.run("What is TypeScript?", context);

console.log("Answer:", result.state.result);
```

## Workflow Archetypes

### LLM Workflow

Structured LLM-powered workflows with context building and response parsing.

```typescript
import { createLLMWorkflow, LLMWorkflowStep } from '@rhythmiclab/rhythmicflow';

const workflow = createLLMWorkflow({
  systemPrompt: "You are a code reviewer.",
  buildContext: async (state) => {
    // Optional: Build RAG context
    return "Relevant docs: ...";
  },
  parseResponse: async (text) => {
    // Optional: Parse response into structured data
    return JSON.parse(text);
  },
  onComplete: async (result, state) => {
    console.log("Completed:", result);
  },
  modelProvider: ModelProvider.claude,
  modelName: ModelName.CLAUDE_SONNET,
  maxRetries: 3,
}, eventCache, eventBus);

// Steps: PREPARING → BUILDING_CONTEXT → CALLING_LLM → PARSING_RESPONSE → COMPLETED
```

### Data Ingestion Workflow

ETL pipeline with discovery, fetching, transformation, validation, and loading.

```typescript
import { createDataIngestionWorkflow } from '@rhythmiclab/rhythmicflow';

const workflow = createDataIngestionWorkflow({
  discover: async () => [{ url: "https://api.example.com/data" }],
  fetch: async (sources) => { /* fetch data */ },
  transform: async (rawData) => { /* transform */ },
  validate: async (processedData) => ({
    valid: true,
    errors: [],
    warnings: [],
    recordCount: processedData.length,
  }),
  load: async (processedData) => ({
    loaded: processedData.length,
    failed: 0,
    duration: 100,
  }),
  loadOnValidationError: false,
}, eventCache, eventBus);

// Steps: DISCOVERING_SOURCES → FETCHING_DATA → TRANSFORMING → VALIDATING → LOADING → COMPLETED
```

### General Workflow

Fully configurable workflow with fluent builder API.

```typescript
import { WorkflowBuilder } from '@rhythmiclab/rhythmicflow';

interface CounterState { count: number; }

const workflow = new WorkflowBuilder<CounterState, "start" | "increment" | "done">()
  .steps(["start", "increment", "done"])
  .initialStep("start")
  .terminalSteps(["done"])
  .handle("start", async (state) => ({
    ...state,
    data: { count: 0 },
  }))
  .handle("increment", async (state) => ({
    ...state,
    data: { count: state.data.count + 1 },
  }))
  .handle("done", async (state) => state)
  .withData({ count: 0 })
  .build(eventCache, eventBus);
```

### MCP Workflow

Model Context Protocol server with tool registration.

```typescript
import { MCPService, ToolRegistry, MCPWebSocketServer } from '@rhythmiclab/rhythmicflow';

// Define tools
const tools = [{
  name: "search",
  description: "Search for information",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  handler: async (params, context) => ({
    content: [{ type: "text", text: `Results for: ${params.query}` }],
    isError: false,
  }),
}];

// Create service with tools
const toolRegistry = new ToolRegistry();
tools.forEach(t => toolRegistry.register(t));

const mcpService = new MCPService(toolRegistry, eventCache, eventBus);

// Start WebSocket server
const wsServer = new MCPWebSocketServer(mcpService, { port: 3001 });
await wsServer.start();
```

### Scheduled Workflow

Cron-based recurring workflows. Each tick creates an isolated workflow execution (with checkpointing and pub/sub) and the `ScheduledWorkflowEngine` wires the scheduler to your handler.

```typescript
import { ScheduledWorkflowEngine } from '@rhythmiclab/rhythmicflow';
import { EventCache, EventBus } from '@rhythmiclab/rhythmic-events';

const eventCache = new EventCache({ maxSize: 1000, ttl: 3_600_000 });
const eventBus   = new EventBus({ enableCache: false });
const scheduler  = new ScheduledWorkflowEngine(eventBus, eventCache);

// Run a task every hour
const scheduleId = await scheduler.schedule(
  {
    cronExpression: "0 * * * *",   // every hour at :00
    startImmediately: true,        // fire once right away too
    maxTicks: 24,                  // run for 24 hours, then exhaust
  },
  {
    execute: async (tick) => {
      console.log(`Tick #${tick.tickNumber} at ${tick.scheduledAt}`);
      // do work...
      return { processed: 42 };
    },
    onComplete: async (result, state) => {
      console.log(`Tick ${state.tickNumber} completed:`, result);
    },
    onError: async (err, state) => {
      console.error(`Tick ${state.tickNumber} failed:`, err.message);
    },
  },
);

// Lifecycle control
scheduler.stop(scheduleId);   // pause
scheduler.start(scheduleId);  // resume
scheduler.unschedule(scheduleId);  // remove permanently
scheduler.cleanup();          // tear down all schedules

// Steps per tick: INITIALIZING → EXECUTING → COMPLETED
```

Typed payloads flow from the descriptor through to the `execute` callback:

```typescript
interface SyncPayload { datasetId: string; since: string; }

await scheduler.schedule<SyncPayload>(
  {
    cronExpression: "*/15 * * * *",
    payload: { datasetId: "orders", since: "2024-01-01" },
  },
  {
    execute: async (tick) => {
      const { datasetId, since } = tick.payload!;
      // sync datasetId since the given date...
    },
  },
);
```

## Core Concepts

### BaseWorkflow State Machine

All workflows extend `BaseWorkflow<State, Step>` which provides:
- Step-based execution with linear or custom progression
- Automatic state checkpointing via `Checkpointer`
- Event publishing via `WorkflowPubSub`
- Configurable retry logic with `maxRetries`
- Terminal step detection for workflow completion

### LLM Providers

Supported providers via Vercel AI SDK:

| Provider | Enum | Example Model |
|----------|------|---------------|
| Claude (Anthropic) | `ModelProvider.claude` | `ModelName.CLAUDE_SONNET` |
| OpenAI | `ModelProvider.openai` | `ModelName.GPT_4O` |
| Google Gemini | `ModelProvider.google` | `ModelName.GEMINI_FLASH` |
| DeepSeek | `ModelProvider.deepseek` | `ModelName.DEEPSEEK_CHAT` |
| Gemma (Ollama) | `ModelProvider.gemma` | `ModelName.GEMMA_9B` |
| OpenRouter | `ModelProvider.openrouter` | `ModelName.OPENROUTER_DEFAULT` |

Configure providers:
```typescript
import { LLMProviderFactory } from '@rhythmiclab/rhythmicflow';

LLMProviderFactory.configure({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
});
```

### Event System

Workflows publish events through `EventBus`:
- `workflow.started` — Workflow begins execution
- `workflow.progress` — Step progress updates
- `workflow.completed` — Workflow successfully completed
- `workflow.failed` — Workflow failed
- `workflow.step.started` — Individual step started
- `workflow.step.completed` — Individual step completed

Subscribe to events:
```typescript
eventBus.subscribe("workflow.*", (event) => {
  console.log(`${event.type}:`, event);
});
```

## Configuration

### WorkflowEngineConfig

```typescript
interface WorkflowEngineConfig {
  enableMcp?: boolean;     // Enable MCP WebSocket server (default: false)
  mcpPort?: number;        // MCP port (default: 3001)
  enableCache?: boolean;    // Enable event caching (default: true)
}
```

Environment variables:
- `ENABLE_MCP=true` — Enable MCP server
- `MCP_WS_PORT=3001` — Set MCP WebSocket port

### LLMWorkflowConfig

```typescript
interface LLMWorkflowConfig<T> {
  systemPrompt: string | (() => string);
  buildContext?: (state: LLMWorkflowState<T>) => Promise<string>;
  parseResponse?: (text: string) => Promise<T>;
  onComplete?: (result: T, state: LLMWorkflowState<T>) => Promise<void>;
  modelProvider?: ModelProvider;
  modelName?: string;
  maxRetries?: number;
  llmProviderOptions?: LLMProviderOptions;
}
```

### ScheduledWorkflowConfig

```typescript
interface ScheduledWorkflowConfig<TPayload = unknown> {
  execute:         (tick: ScheduledTickContext<TPayload>) => Promise<unknown>;
  validate?:       (tick: ScheduledTickContext<TPayload>) => Promise<void>;
  onComplete?:     (result: unknown, state: ScheduledWorkflowState<TPayload>) => Promise<void>;
  onError?:        (error: Error, state: ScheduledWorkflowState<TPayload>) => Promise<void>;
  contextFactory?: (tick: ScheduledTickContext<TPayload>) => WorkflowContext;
  maxRetries?:     number;  // retries per tick (default: 0)
  channelPrefix?:  string;
}
```

## API Reference

### Core
- `WorkflowEngine` — Top-level composition root
- `WorkflowEngineConfig` — Engine configuration

### Base Types
- `BaseWorkflow<State, Step>` — Abstract base class
- `BaseWorkflowState<Step, Status>` — Base state interface
- `BaseWorkflowStatus` — Status enum
- `StepHandler<State>` — Step handler type
- `WorkflowContext` — Request context
- `WorkflowResult<State>` — Execution result

### Workflow Archetypes
- `createLLMWorkflow()` — Factory for LLM workflows
- `createDataIngestionWorkflow()` — Factory for data ingestion
- `GeneralWorkflow` — Generic configurable workflow
- `WorkflowBuilder` — Fluent builder for GeneralWorkflow
- `MCPWorkflow` — MCP protocol workflow
- `ScheduledWorkflow` — Per-tick cron workflow
- `ScheduledWorkflowEngine` — Cron schedule orchestrator
- `createScheduledWorkflowEngine()` — Factory for the engine

### MCP
- `MCPService` — MCP service class
- `ToolRegistry` — Tool registration
- `MCPWebSocketServer` — WebSocket server
- `createMCPServer()` — Server factory

### State & Events
- `Checkpointer` — State persistence
- `WorkflowPubSub` — Event publishing
- `WorkflowStartedEvent` — Workflow started
- `WorkflowCompletedEvent` — Workflow completed
- `WorkflowFailedEvent` — Workflow failed

### LLM
- `LLMProviderFactory` — Provider factory
- `ModelProvider` — Provider enum
- `ModelName` — Model enum
- `VALID_MODELS` — Valid models per provider
- `DEFAULT_MODEL` — Default model per provider

## Development

### Prerequisites
- Node.js 18+
- npm or bun

### Scripts

| Script | Command | Description |
|--------|----------|-------------|
| Build | `npm run build` | Compile TypeScript to `dist/` |
| Type Check | `npm run type-check` | TypeScript type checking |
| Test | `npm run test` | Run tests with Bun |
| Test Watch | `npm run test:watch` | Run tests in watch mode |
| Test Coverage | `npm run test:coverage` | Run tests with coverage |
| Lint | `npm run lint` | ESLint checking |
| Lint Fix | `npm run lint:fix` | ESLint with auto-fix |
| Format | `npm run format` | Prettier formatting |
| Format Check | `npm run format:check` | Check formatting |
| Check All | `npm run check-all` | All checks (type + lint + format + test) |

### Testing

Uses Bun Test framework:

```bash
# Run all tests
bun test

# Run specific test file
bun test src/types/__tests__/checkpointer.test.ts

# Run with coverage
bun test --coverage
```

### Project Structure

```
src/
├── core.ts                      # WorkflowEngine
├── index.ts                     # Public API barrel
├── workflows/                   # Workflow implementations
│   ├── base-workflow.ts        # Abstract state machine
│   ├── llm-workflow.ts         # LLM workflow
│   ├── data-ingestion-workflow.ts
│   ├── general-workflow.ts      # + WorkflowBuilder
│   ├── mcp-workflow.ts          # MCP protocol
│   └── scheduled-workflow.ts   # Cron-based scheduled workflow
├── mcp/                         # MCP support
│   ├── service.ts              # MCPService
│   ├── tool-registry.ts        # ToolRegistry
│   ├── types.ts                # JSON-RPC 2.0 types
│   └── tools/graph.ts          # Example tools
├── llm/                         # LLM providers
│   ├── providers.ts            # LLMProviderFactory
│   └── router.ts              # LLMRouter
├── types/                       # Type definitions
│   ├── workflow.ts             # Base types
│   ├── workflow-states.ts      # Archetype states
│   └── enums.ts                # Model enums
├── events/                      # Workflow events
│   └── workflow.ts
├── rag/                         # RAG services (stubs)
├── state/                       # State management
└── prompts/                    # Prompt utilities
```

## Examples

See [examples.md](examples.md) for comprehensive real-world examples of all workflow types.

## License

BUSL-1.1 — See [LICENSE](LICENSE) file for details.
