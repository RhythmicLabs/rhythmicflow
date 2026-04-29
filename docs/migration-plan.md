# Kubegram Core Migration & Deprecation Plan

## Overview

This document outlines the plan for:
1. **Copying** code from kuberag to kubegram-core
2. **Deprecating** the original code in kuberag
3. **Transitioning** kuberag to use kubegram-core as a dependency

## Phase 1: Copy Files to kubegram-core

### 1.1 Types (No Dependencies - Copy As-Is)

**Source**: `kuberag/src/types/`
**Destination**: `kubegram-core/src/types/`

| File | Notes |
|------|-------|
| `graph.ts` | Core graph types |
| `codegen.ts` | Codegen types |
| `enums.ts` | ModelProvider, Job. |
| `StatusStatus, etcworkflow.ts` | Workflow context types |
| `ambient.d.ts` | Ambient declarations |

### 1.2 State Management (Adapt for kubegram-core)

**Source**: `kuberag/src/state/`
**Destination**: `kubegram-core/src/state/`

| File | Adaptations Needed |
|------|-------------------|
| `redis.ts` | Remove kuberag-specific config; accept config via constructor |
| `cache.ts` | Make configurable, add event integration |
| `pubsub.ts` | Add integration with `@kubegram/events` |
| `checkpointer.ts` | Add workflow state serialization |

### 1.3 Services

**Source**: `kuberag/src/services/`
**Destination**: `kubegram-core/src/services/`

| File | Adaptations Needed |
|------|-------------------|
| `codegen-service.ts` | Replace local state imports with `@kubegram/events` |
| `plan-service.ts` | Same as above |
| `entity-service.ts` | May stay in kuberag (GraphQL-specific) |

### 1.4 Workflows

**Source**: `kuberag/src/workflows/`
**Destination**: `kubegram-core/src/workflows/`

| File | Adaptations Needed |
|------|-------------------|
| `base-workflow.ts` | Make abstract base reusable |
| `codegen-workflow.ts` | Emit events instead of local pub/sub |
| `plan-workflow.ts` | Same as above |
| `types.ts` | Workflow state types |

### 1.5 LLM & RAG

**Source**: `kuberag/src/llm/`, `kuberag/src/rag/`, `kuberag/src/prompts/`
**Destination**: `kubegram-core/src/llm/`, `kubegram-core/src/rag/`, `kubegram-core/src/prompts/`

| File | Adaptations Needed |
|------|-------------------|
| `llm/providers.ts` | Make provider factory reusable |
| `rag/embeddings.ts` | Add config injection |
| `rag/context.ts` | Make context builder reusable |
| `prompts/system.ts` | Keep as-is |
| `prompts/node-generators.ts` | Keep as-is |
| `prompts/parser.ts` | Keep as-is |

### 1.6 Database

**Source**: `kuberag/src/db/`
**Destination**: `kubegram-core/src/db/`

| File | Adaptations Needed |
|------|-------------------|
| `client.ts` | Make Dgraph client configurable |

### 1.7 MCP (Model Context Protocol)

**Source**: `kuberag/src/mcp/`
**Destination**: `kubegram-core/src/mcp/`

| File | Adaptations Needed |
|------|-------------------|
| `index.ts` | Make service configurable |
| `service.ts` | Accept core as dependency |
| `websocket-server.ts` | Make port configurable via env |
| `websocket-handler.ts` | Keep as-is |
| `tool-registry.ts` | Keep as-is |
| `checkpointer.ts` | Keep as-is |
| `connection-registry.ts` | Keep as-is |
| `types.ts` | Keep as-is |
| `workflow.ts` | Keep as-is |
| `tools/codegen.ts` | Adapt to use core services |
| `tools/planning.ts` | Adapt to use core services |
| `tools/graphs.ts` | Adapt to use core services |

### 1.8 Config & Utils

**Source**: `kuberag/src/config.ts`, `kuberag/src/utils/`
**Destination**: `kubegram-core/src/config.ts`, `kubegram-core/src/utils/`

| File | Adaptations Needed |
|------|-------------------|
| `config.ts` | Use Zod for validation |
| `utils/codegen.ts` | Keep as-is |

## Phase 2: Deprecation Strategy

### 2.1 Mark Code as Deprecated

In kuberag files that have been copied to kubegram-core, add deprecation notices:

```typescript
/**
 * @deprecated Import from @kubegram/kubegram-core instead
 * This module will be removed in v2.0.0
 */
```

### 2.2 Update Import Paths

Migrate imports in kuberag to use kubegram-core:

```typescript
// Before (kuberag/src/services/codegen-service.ts)
import { runCodegenWorkflow } from '../workflows/codegen-workflow';

// After (kuberag/src/services/codegen-service.ts)
import { runCodegenWorkflow } from '@kubegram/kubegram-core/workflows/codegen-workflow';
```

### 2.3 Keep Shims for Backward Compatibility

Maintain thin wrappers in kuberag that re-export from kubegram-core:

```typescript
// kuberag/src/workflows/codegen-workflow.ts
/**
 * @deprecated Import from @kubegram/kubegram-core
 */
export { runCodegenWorkflow, getCodegenWorkflowStatus } from '@kubegram/kubegram-core';
```

## Phase 3: Version Timeline

| Version | Changes |
|---------|---------|
| **v1.x (Current)** | kuberag standalone, kubegram-core created |
| **v1.1.0** | kubegram-core published, kuberag adds deprecation notices |
| **v1.2.0** | kuberag uses kubegram-core internally, GraphQL layer remains |
| **v2.0.0** | kuberag becomes thin GraphQL wrapper, old code removed |
| **v2.1.0** | MCP becomes toggleable in kubegram-core via env var |

## Phase 4: Environment Variables

The MCP integration should be controlled by an environment variable in kubegram-core:

```env
# In kubegram-core
ENABLE_MCP=true  # Enable MCP WebSocket server (default: false)
MCP_WS_PORT=3001
```

## Phase 5: Integration Points

### kubegram-server Integration

The server currently calls kuberag via GraphQL. After migration:

```
kubegram-server → kuberag (GraphQL) → kubegram-core (services)
                        OR
kubegram-server → kubegram-core (direct)
```

Option A: Keep GraphQL (simpler, no server changes)
Option B: Direct service calls (removes kuberag dependency)

## Files to Copy Summary

```
kuberag/src/types/*          → kubegram-core/src/types/*
kuberag/src/state/*          → kubegram-core/src/state/* (adapted)
kuberag/src/services/*       → kubegram-core/src/services/* (adapted)
kuberag/src/workflows/*      → kubegram-core/src/workflows/* (adapted)
kuberag/src/llm/*           → kubegram-core/src/llm/*
kuberag/src/rag/*           → kubegram-core/src/rag/*
kuberag/src/prompts/*       → kubegram-core/src/prompts/*
kuberag/src/db/*            → kubegram-core/src/db/*
kuberag/src/mcp/*           → kubegram-core/src/mcp/*
kuberag/src/config.ts       → kubegram-core/src/config.ts
kuberag/src/utils/*         → kubegram-core/src/utils/*
```

## Files to Keep in kuberag (GraphQL Layer)

These files are specific to kuberag's GraphQL API and should NOT be copied:

- `kuberag/src/graphql/*` - GraphQL schema and resolvers
- `kuberag/src/index.ts` - Hono + GraphQL Yoga server setup
- `kuberag/src/middleware/*` - HTTP middleware

## Acceptance Criteria

1. ✅ kubegram-core builds successfully
2. ✅ kubegram-core can be published to GitHub Packages
3. ✅ kuberag uses kubegram-core for core functionality
4. ✅ MCP can be toggled on/off via `ENABLE_MCP` env var
5. ✅ All events use `@kubegram/events` pattern
6. ✅ No breaking changes to kubegram-server integration
