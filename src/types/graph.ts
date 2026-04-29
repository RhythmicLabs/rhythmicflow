export type ID = string;
export type JSONData = Record<string, unknown>;
export type YAMLString = string;

export interface GenericEdge {
  connectionType: string;
  targetNodeId: ID;
  metadata?: Record<string, unknown>;
}

export interface GenericNode {
  id: ID;
  name: string;
  nodeType: string;
  edges?: GenericEdge[];
  spec?: JSONData;
  metadata?: Record<string, unknown>;
}

export interface GenericGraph {
  id: ID;
  name: string;
  description?: string;
  graphType?: string;
  nodes?: GenericNode[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
