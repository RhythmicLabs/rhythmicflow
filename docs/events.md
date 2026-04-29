# Kubegram Core - Domain Events Specification

## Overview

This document defines the domain events used by kubegram-core for orchestrating code generation and infrastructure planning workflows.

## Events Architecture

Kubegram Core uses `@kubegram/events` for event-driven orchestration:

- **EventBus**: Pub/sub messaging for workflow updates
- **DomainEvent**: Base class for all events with DDD patterns
- **EventCache**: Optional caching for event history
- **SuspensionManager**: Request-response patterns

## Codegen Events

### CodegenStartedEvent

Fired when a code generation job is initiated.

```typescript
class CodegenStartedEvent extends DomainEvent {
  constructor(
    public readonly jobId: string,
    public readonly userId: string,
    public readonly graphId: string,
    public readonly graphData: GraphInput,
    public readonly options: CodegenOptions,
    aggregateId?: string
  ) {
    super('codegen.started', aggregateId);
  }
}
```

**Payload**:
- `jobId`: Unique identifier for the job
- `userId`: User who initiated the job
- `graphId`: ID of the graph being processed
- `graphData`: The graph input data
- `options`: Code generation options (provider, model, etc.)

### CodegenProgressEvent

Fired periodically to report workflow progress.

```typescript
class CodegenProgressEvent extends DomainEvent {
  constructor(
    public readonly jobId: string,
    public readonly step: CodegenStep,
    public readonly progress: number, // 0-100
    public readonly message: string,
    public readonly details?: Record<string, unknown>,
    aggregateId?: string
  ) {
    super('codegen.progress', aggregateId);
  }
}
```

**Steps**:
1. `GET_OR_CREATE_GRAPH`
2. `GET_PROMPT`
3. `LLM_CALL`
4. `BUILD_KUBERNETES_GRAPH`
5. `VALIDATE_CONFIGURATIONS`

### CodegenCompletedEvent

Fired when code generation completes successfully.

```typescript
class CodegenCompletedEvent extends DomainEvent {
  constructor(
    public readonly jobId: string,
    public readonly manifests: KubernetesManifest[],
    public readonly graphId: string,
    public readonly processingTime: number,
    aggregateId?: string
  ) {
    super('codegen.completed', aggregateId);
  }
}
```

**Payload**:
- `jobId`: Unique identifier for the job
- `manifests`: Generated Kubernetes manifests
- `graphId`: ID of the source graph
- `processingTime`: Time taken in milliseconds

### CodegenFailedEvent

Fired when code generation fails.

```typescript
class CodegenFailedEvent extends DomainEvent {
  constructor(
    public readonly jobId: string,
    public readonly error: string,
    public readonly step?: CodegenStep,
    public readonly retryable: boolean = false,
    aggregateId?: string
  ) {
    super('codegen.failed', aggregateId);
  }
}
```

### CodegenCancelledEvent

Fired when a code generation job is cancelled.

```typescript
class CodegenCancelledEvent extends DomainEvent {
  constructor(
    public readonly jobId: string,
    public readonly cancelledBy: string,
    aggregateId?: string
  ) {
    super('codegen.cancelled', aggregateId);
  }
}
```

## Planning Events

### PlanStartedEvent

Fired when a planning job is initiated.

```typescript
class PlanStartedEvent extends DomainEvent {
  constructor(
    public readonly jobId: string,
    public readonly userId: string,
    public readonly graphId: string,
    public readonly planningType: PlanningType,
    aggregateId?: string
  ) {
    super('plan.started', aggregateId);
  }
}
```

### PlanProgressEvent

Fired to report planning workflow progress.

```typescript
class PlanProgressEvent extends DomainEvent {
  constructor(
    public readonly jobId: string,
    public readonly step: PlanStep,
    public readonly progress: number,
    public readonly message: string,
    aggregateId?: string
  ) {
    super('plan.progress', aggregateId);
  }
}
```

### PlanCompletedEvent

Fired when planning completes.

```typescript
class PlanCompletedEvent extends DomainEvent {
  constructor(
    public readonly jobId: string,
    public readonly plan: InfrastructurePlan,
    public readonly processingTime: number,
    aggregateId?: string
  ) {
    super('plan.completed', aggregateId);
  }
}
```

### PlanFailedEvent

Fired when planning fails.

```typescript
class PlanFailedEvent extends DomainEvent {
  constructor(
    public readonly jobId: string,
    public readonly error: string,
    aggregateId?: string
  ) {
    super('plan.failed', aggregateId);
  }
}
```

## Event Usage Patterns

### Publishing Events

```typescript
import { EventBus, DomainEvent } from '@kubegram/events';
import { CodegenStartedEvent } from './events/codegen';

const eventBus = new EventBus({ enableCache: true });

// Publish event
const event = new CodegenStartedEvent(
  'job-123',
  'user-456',
  'graph-789',
  graphData,
  { provider: 'anthropic', model: 'claude-3-5-sonnet' }
);
await eventBus.publish(event);
```

### Subscribing to Events

```typescript
// Subscribe to codegen events
eventBus.subscribe('codegen.progress', async (event: CodegenProgressEvent) => {
  console.log(`Job ${event.jobId}: ${event.progress}% - ${event.message}`);
});

eventBus.subscribe('codegen.completed', async (event: CodegenCompletedEvent) => {
  console.log(`Job ${event.jobId} completed with ${event.manifests.length} manifests`);
});
```

### Request-Response with Suspension

```typescript
import { SuspensionManager, LocalPubSubProvider } from '@kubegram/events';

const provider = new LocalPubSubProvider();
const suspensionManager = new SuspensionManager(provider);

// Request codegen and wait for result
const request = new CodegenStartedEvent(...);
const result = await suspensionManager.suspendForResponse(
  request,
  'codegen.completed',
  request.jobId,
  { timeout: 300000 } // 5 minutes
);
```

## Event Registry

Events should be registered with the EventRegistry for serialization:

```typescript
import { EventRegistry } from '@kubegram/events';

EventRegistry.getInstance().register(
  'codegen.started',
  (json) => new CodegenStartedEvent(
    json.metadata.jobId,
    json.metadata.userId,
    json.metadata.graphId,
    json.metadata.graphData,
    json.metadata.options,
    json.aggregateId
  )
);
```

## Caching Strategy

Events can be cached for history retrieval:

```typescript
const eventBus = new EventBus({
  enableCache: true,
  cacheSize: 1000,
  cacheTTL: 3600000, // 1 hour
});

// Get event history
const history = await eventBus.getEventHistory('codegen.completed', 10);
```
