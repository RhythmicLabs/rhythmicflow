# CLAUDE.md - Project Context for AI Assistants

## Project Overview
- **Package**: @rhythmiclab/rhythmicflow
- **Version**: 1.0.3
- **Purpose**: Generic workflow library (refactored from K8s-specific @kubegram/kubegram-core)
- **Runtime**: Bun (tests) + Node (production)
- **Language**: TypeScript 5.9+ (strict mode)
- **License**: BUSL-1.1

## Common Commands

| Command | Purpose |
|---------|----------|
| `npm run build` | Compile TS to `dist/` using tsc |
| `npm run type-check` | TypeScript type checking (no emit) |
| `bun test` | Run tests with Bun Test |
| `bun test --coverage` | Run tests with coverage |
| `npm run lint` | ESLint with TypeScript parser |
| `npm run format` | Prettier formatting |
| `npm run check-all` | All checks (type + lint + format + test) |

## Project Structure

```
src/
├── core.ts                    # WorkflowEngine - main entry point
├── index.ts                   # Public API barrel file
├── workflows/                 # Workflow implementations
│   ├── base-workflow.ts      # Abstract BaseWorkflow state machine
│   ├── llm-workflow.ts       # LLM workflow archetype
│   ├── data-ingestion-workflow.ts
│   ├── general-workflow.ts    # + WorkflowBuilder fluent API
│   └── mcp-workflow.ts       # MCP protocol workflow
├── mcp/                      # Model Context Protocol support
│   ├── service.ts           # MCPService
│   ├── tool-registry.ts     # ToolRegistry class
│   ├── types.ts             # JSON-RPC 2.0 types
│   ├── websocket-server.ts  # MCPWebSocketServer
│   ├── websocket-handler.ts # createMCPServer()
│   └── tools/graph.ts       # Example tool implementation
├── llm/                      # LLM provider integrations
│   ├── providers.ts         # LLMProviderFactory
│   └── router.ts           # LLMRouter
├── types/                    # Type definitions
│   ├── workflow.ts          # BaseWorkflowState, WorkflowContext
│   ├── workflow-states.ts   # Archetype state types
│   ├── enums.ts             # ModelProvider, ModelName
│   ├── checkpointer.ts     # Checkpointer class
│   └── graph.ts            # GenericGraph types
├── events/                   # Workflow events
│   └── workflow.ts          # WorkflowStartedEvent, etc.
├── rag/                      # RAG (stubs)
│   ├── embeddings.ts        # EmbeddingsService (stub)
│   └── context.ts           # RagContextService (stub)
├── state/                    # State management
│   ├── manager.ts           # StateManager (stub)
│   └── pubsub.ts           # WorkflowPubSub
└── prompts/                 # Prompt utilities
    └── context-utils.ts     # processUserContext()
```

## Architecture Notes

### BaseWorkflow State Machine
- All workflows extend `BaseWorkflow<State, Step>`
- Implements step-based execution with checkpointing
- State persisted via `Checkpointer` → `EventCache` (from @kubegram/events)
- Events published via `WorkflowPubSub` → `EventBus`
- Automatic retry logic with configurable `maxRetries`
- Terminal steps stop execution

### Workflow Archetypes
1. **LLMWorkflow** - 5 steps: PREPARING → BUILDING_CONTEXT → CALLING_LLM → PARSING_RESPONSE → COMPLETED
2. **DataIngestionWorkflow** - 6 steps: DISCOVERING_SOURCES → FETCHING_DATA → TRANSFORMING → VALIDATING → LOADING → COMPLETED
3. **GeneralWorkflow** - Fully configurable via `GeneralWorkflowConfig` + `WorkflowBuilder`
4. **MCPWorkflow** - JSON-RPC 2.0 protocol over WebSocket

### LLM Integration
- Uses Vercel AI SDK (`ai` package)
- `LLMProviderFactory` creates provider instances
- Supported: Claude, OpenAI, Google, DeepSeek, Gemma (Ollama), OpenRouter
- Configure via `LLMProviderFactory.configure(options)`

### MCP Protocol
- Implements Model Context Protocol (JSON-RPC 2.0)
- Tools registered via `ToolRegistry`
- `MCPService` wraps workflow + tools + connection management
- WebSocket transport via `MCPWebSocketServer` or `createMCPServer()`

## Coding Conventions

- **Module system**: ES modules (`"type": "module"`)
- **TypeScript**: Strict mode enabled, no decorators
- **Imports**: Use `.js` extension for local imports (ESM compatibility)
- **Validation**: Zod for schema validation (MCP tools)
- **Tests**: Bun Test framework (`bun:test`)
- **Linting**: ESLint 9.x with @typescript-eslint
- **Formatting**: Prettier 3.x

## Pattern: Adding a New Workflow Archetype

To add a new workflow archetype (e.g., `CustomWorkflow`), follow this pattern:

### Step 1: Define Step Enum and State Type

```typescript
// src/types/workflow-states.ts

export enum CustomWorkflowStep {
  STEP_ONE = "step_one",
  STEP_TWO = "step_two",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface CustomWorkflowState extends BaseWorkflowState<
  CustomWorkflowStep,
  BaseWorkflowStatus
> {
  // Add custom state fields here
  customField: string;
  result?: unknown;
}
```

### Step 2: Define Config Interface

```typescript
// src/types/workflow-states.ts

export interface CustomWorkflowConfig {
  someOption: string;
  maxRetries?: number;
  onComplete?: (result: unknown, state: CustomWorkflowState) => Promise<void>;
}
```

### Step 3: Create Workflow Class

```typescript
// src/workflows/custom-workflow.ts

import { type EventCache, type EventBus } from "@kubegram/events";
import { BaseWorkflow } from "./base-workflow.js";
import { Checkpointer } from "../types/checkpointer.js";
import { WorkflowPubSub } from "../state/pubsub.js";
import { BaseWorkflowStatus, StepHandler, WorkflowContext, WorkflowResult } from "../types/workflow.js";
import { CustomWorkflowStep, CustomWorkflowState, CustomWorkflowConfig } from "../types/workflow-states.js";

export class CustomWorkflow extends BaseWorkflow<
  CustomWorkflowState,
  CustomWorkflowStep
> {
  protected readonly steps: CustomWorkflowStep[] = [
    CustomWorkflowStep.STEP_ONE,
    CustomWorkflowStep.STEP_TWO,
    CustomWorkflowStep.COMPLETED,
  ];

  protected readonly handlers: Record<
    CustomWorkflowStep,
    StepHandler<CustomWorkflowState>
  > = {
    [CustomWorkflowStep.STEP_ONE]: this.handleStepOne.bind(this),
    [CustomWorkflowStep.STEP_TWO]: this.handleStepTwo.bind(this),
    [CustomWorkflowStep.COMPLETED]: this.handleCompleted.bind(this),
    [CustomWorkflowStep.FAILED]: this.handleFailed.bind(this),
  };

  protected readonly initialStep = CustomWorkflowStep.STEP_ONE;
  protected readonly terminalSteps = [
    CustomWorkflowStep.COMPLETED,
    CustomWorkflowStep.FAILED,
  ];
  protected readonly channelPrefix = "custom";

  constructor(
    private readonly config: CustomWorkflowConfig,
    eventCache: EventCache,
    eventBus: EventBus,
  ) {
    super(
      new Checkpointer<CustomWorkflowState>(eventCache, "custom"),
      new WorkflowPubSub(eventBus),
    );
  }

  async run(context: WorkflowContext): Promise<WorkflowResult<CustomWorkflowState>> {
    const initialState: CustomWorkflowState = {
      customField: "",
      currentStep: CustomWorkflowStep.STEP_ONE,
      stepHistory: [],
      status: BaseWorkflowStatus.PENDING,
      retryCount: 0,
      maxRetries: this.config.maxRetries ?? 3,
      startTime: new Date().toISOString(),
    };

    return this.execute(initialState, context);
  }

  private async handleStepOne(state: CustomWorkflowState): Promise<CustomWorkflowState> {
    // Implement step logic
    return {
      ...state,
      customField: "processed",
      currentStep: CustomWorkflowStep.STEP_TWO,
    };
  }

  private async handleStepTwo(state: CustomWorkflowState): Promise<CustomWorkflowState> {
    // Implement step logic
    return {
      ...state,
      currentStep: CustomWorkflowStep.COMPLETED,
    };
  }

  private async handleCompleted(state: CustomWorkflowState): Promise<CustomWorkflowState> {
    await this.config.onComplete?.(state.result, state);
    return state;
  }

  private async handleFailed(state: CustomWorkflowState): Promise<CustomWorkflowState> {
    return state;
  }
}

// Optional: Factory function
export function createCustomWorkflow(
  config: CustomWorkflowConfig,
  eventCache: EventCache,
  eventBus: EventBus,
): CustomWorkflow {
  return new CustomWorkflow(config, eventCache, eventBus);
}
```

### Step 4: Export from index.ts

```typescript
// src/index.ts

export type { CustomWorkflowStep, CustomWorkflowState, CustomWorkflowConfig } from './types/workflow-states.js';
export { CustomWorkflow, createCustomWorkflow } from './workflows/custom-workflow.js';
```

---

## Pattern: Adding New MCP Tools

### Using ToolRegistry Directly

```typescript
import { ToolRegistry, ToolDefinition, MCPToolResult } from '@rhythmiclab/rhythmicflow';
import { WorkflowContext } from '@rhythmiclab/rhythmicflow';

// Define tool
const searchTool: ToolDefinition = {
  name: "search",
  description: "Search for information",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  handler: async (params: Record<string, unknown>, context: WorkflowContext): Promise<MCPToolResult> => {
    const query = params.query as string;
    // Implement search logic
    return {
      content: [{ type: "text", text: `Search results for: ${query}` }],
      isError: false,
    };
  },
};

// Register tool
const registry = new ToolRegistry();
registry.register(searchTool);

// Or use factory
const registry = createToolRegistry([searchTool]);
```

### Adding to MCPService

```typescript
import { MCPService } from '@rhythmiclab/rhythmicflow';

const service = new MCPService(registry, eventCache, eventBus);

// Add tool at runtime
service.registerTool(searchTool);
```

---

## Refactor History

- **From**: @kubegram/kubegram-core (Kubernetes-specific)
- **To**: @rhythmiclab/rhythmicflow (generic workflow library)
- **Changes**:
  - Deleted all K8s-specific workflows (codegen, plan, validation)
  - Removed BAML dependency and baml_src/
  - Stripped K8s enums from types/enums.ts
  - Renamed KubegramCore → WorkflowEngine
  - Created 4 generic workflow archetypes
  - Rewrote MCP tools to use ToolRegistry pattern
  - Updated package.json (name, description, keywords)

## Important Notes

- Always use `.js` extension in imports (ESM compatibility)
- `WorkflowContext` does NOT have `companyId` (removed during refactor)
- All K8s-specific files deleted (Phase 1 complete)
- BAML removed entirely - LLM providers use Vercel AI SDK
- Tests run with Bun, not Jest/Vitest
- EventCache from @kubegram/events handles state persistence
- Use factory functions (`createLLMWorkflow`) not direct constructors
- `WorkflowBuilder` for complex GeneralWorkflow setup
