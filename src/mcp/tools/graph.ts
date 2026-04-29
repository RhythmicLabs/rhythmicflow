import type { MCPToolResult } from "../types.js";
import type { ToolDefinition } from "../tool-registry.js";
import type { GenericGraph, GenericNode } from "../../types/graph.js";
import type { WorkflowContext } from "../../types/workflow.js";

export interface GraphService {
  queryGraphs(params: {
    graphType?: string;
    nameContains?: string;
    limit?: number;
    offset?: number;
    metadata?: Record<string, unknown>;
  }): Promise<GenericGraph[]>;

  getGraph(
    graphId: string,
    options?: { includeNodes?: boolean },
  ): Promise<GenericGraph | null>;

  createGraph(input: {
    name: string;
    description?: string;
    graphType?: string;
    nodes?: GenericNode[];
    userId: string;
    metadata?: Record<string, unknown>;
  }): Promise<GenericGraph>;

  updateGraph(
    graphId: string,
    input: { name?: string; description?: string; metadata?: Record<string, unknown> },
  ): Promise<GenericGraph | null>;

  deleteGraph(graphId: string): Promise<boolean>;

  getRAGContext(
    graphId: string,
    limit?: number,
  ): Promise<{ graphs: GenericGraph[]; similarity: number[] }>;
}

const noService: MCPToolResult = {
  content: [{ type: "text", text: "GraphService is not configured on this MCPService instance." }],
  isError: true,
};

function wrap<T>(fn: () => Promise<T>): Promise<MCPToolResult> {
  return fn()
    .then((result) => ({
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: false,
    }))
    .catch((error) => ({
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    }));
}

export function createGraphTools(graphService: GraphService): ToolDefinition[] {
  return [
    {
      name: "query_graphs",
      description: "Query graphs with optional filters.",
      inputSchema: {
        type: "object",
        properties: {
          graphType: { type: "string", description: "Filter by graph type" },
          nameContains: { type: "string", description: "Filter by name substring" },
          limit: { type: "number", description: "Max results (default 10)" },
          offset: { type: "number", description: "Pagination offset" },
        },
      },
      handler: (params: Record<string, unknown>, _context: WorkflowContext) =>
        wrap(() => graphService.queryGraphs(params as Parameters<GraphService["queryGraphs"]>[0])),
    },
    {
      name: "get_graph",
      description: "Retrieve a graph by ID.",
      inputSchema: {
        type: "object",
        properties: {
          graphId: { type: "string", description: "Graph ID" },
          includeNodes: { type: "boolean", description: "Include node list" },
        },
        required: ["graphId"],
      },
      handler: async (params: Record<string, unknown>, _context: WorkflowContext) => {
        const graph = await graphService.getGraph(params.graphId as string, {
          includeNodes: params.includeNodes as boolean | undefined,
        });
        if (!graph) {
          return { content: [{ type: "text" as const, text: `Graph not found: ${params.graphId}` }], isError: false };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(graph, null, 2) }], isError: false };
      },
    },
    {
      name: "create_graph",
      description: "Create a new graph.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Graph name" },
          description: { type: "string", description: "Optional description" },
          graphType: { type: "string", description: "Graph type identifier" },
          nodes: { type: "array", description: "Initial nodes" },
          metadata: { type: "object", description: "Additional metadata" },
        },
        required: ["name"],
      },
      handler: (params: Record<string, unknown>, context: WorkflowContext) =>
        wrap(() =>
          graphService.createGraph({
            name: params.name as string,
            description: params.description as string | undefined,
            graphType: params.graphType as string | undefined,
            nodes: params.nodes as GenericNode[] | undefined,
            metadata: params.metadata as Record<string, unknown> | undefined,
            userId: context.userId,
          }),
        ),
    },
    {
      name: "update_graph",
      description: "Update graph metadata.",
      inputSchema: {
        type: "object",
        properties: {
          graphId: { type: "string", description: "Graph ID" },
          name: { type: "string" },
          description: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["graphId"],
      },
      handler: async (params: Record<string, unknown>, _context: WorkflowContext) => {
        const graph = await graphService.updateGraph(params.graphId as string, {
          name: params.name as string | undefined,
          description: params.description as string | undefined,
          metadata: params.metadata as Record<string, unknown> | undefined,
        });
        if (!graph) {
          return { content: [{ type: "text" as const, text: `Graph not found: ${params.graphId}` }], isError: false };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(graph, null, 2) }], isError: false };
      },
    },
    {
      name: "delete_graph",
      description: "Delete a graph by ID.",
      inputSchema: {
        type: "object",
        properties: {
          graphId: { type: "string", description: "Graph ID" },
        },
        required: ["graphId"],
      },
      handler: async (params: Record<string, unknown>, _context: WorkflowContext) => {
        const success = await graphService.deleteGraph(params.graphId as string);
        return {
          content: [{
            type: "text" as const,
            text: success
              ? `Successfully deleted graph: ${params.graphId}`
              : `Failed to delete graph: ${params.graphId}`,
          }],
          isError: !success,
        };
      },
    },
    {
      name: "get_rag_context",
      description: "Retrieve similar graphs for RAG context.",
      inputSchema: {
        type: "object",
        properties: {
          graphId: { type: "string", description: "Source graph ID" },
          limit: { type: "number", description: "Max results" },
        },
        required: ["graphId"],
      },
      handler: (params: Record<string, unknown>, _context: WorkflowContext) =>
        wrap(() =>
          graphService.getRAGContext(params.graphId as string, params.limit as number | undefined),
        ),
    },
  ];
}

export { noService };
