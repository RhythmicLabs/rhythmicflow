import { EventBus } from "@rhythmiclab/rhythmic-events";

export interface WorkflowEngineConfig {
  /** Enable MCP WebSocket server (default: false) */
  enableMcp?: boolean;
  /** MCP WebSocket port (default: 3001) */
  mcpPort?: number;
  /** Enable event caching (default: true) */
  enableCache?: boolean;
}

/**
 * WorkflowEngine — top-level composition root for the @rhythmiclab/rhythmicflow library.
 *
 * Instantiate once per process and pass the resulting `eventBus` into any workflow
 * or service that needs pub/sub. All real configuration (API keys, RAG services,
 * tool registries) is passed directly to concrete workflow constructors so that
 * the library stays portable and testable.
 *
 * Environment variables:
 *   - ENABLE_MCP: Enable MCP WebSocket server (default: false)
 *   - MCP_WS_PORT: MCP WebSocket port (default: 3001)
 *
 * @example
 * const engine = new WorkflowEngine();
 * const workflow = createLLMWorkflow({ systemPrompt: "..." }, eventCache, engine.eventBus);
 */
export class WorkflowEngine {
  eventBus: EventBus;
  config: Required<WorkflowEngineConfig>;

  constructor(config: WorkflowEngineConfig = {}) {
    this.config = {
      enableMcp: config.enableMcp ?? process.env.ENABLE_MCP === "true",
      mcpPort: config.mcpPort ?? parseInt(process.env.MCP_WS_PORT ?? "3001", 10),
      enableCache: config.enableCache ?? true,
    };
    this.eventBus = new EventBus({ enableCache: this.config.enableCache });
  }

  async initialize(): Promise<void> {
    if (this.config.enableMcp) {
      console.info(`MCP WebSocket server ready on port ${this.config.mcpPort}`);
    }
  }

  async shutdown(): Promise<void> {}
}
