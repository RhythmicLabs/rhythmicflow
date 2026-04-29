# Examples

Real-world usage examples for every workflow archetype in `@rhythmiclab/rhythmicflow`.

---

## Setup (shared across examples)

```typescript
import { WorkflowEngine } from '@rhythmiclab/rhythmicflow';
import { EventCache, EventBus } from '@rhythmiclab/rhythmic-events';

const engine     = new WorkflowEngine();
const eventCache = new EventCache({ maxSize: 1000, ttl: 3_600_000 });
const eventBus   = engine.eventBus;
```

---

## LLM Workflow

### Document Summarizer

Summarizes a document and parses the response into structured JSON.

```typescript
import {
  createLLMWorkflow,
  LLMProviderFactory,
  ModelProvider,
  ModelName,
} from '@rhythmiclab/rhythmicflow';

LLMProviderFactory.configure({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
});

interface SummaryResult {
  title:      string;
  keyPoints:  string[];
  sentiment:  'positive' | 'neutral' | 'negative';
  wordCount:  number;
}

const summaryWorkflow = createLLMWorkflow<SummaryResult>({
  systemPrompt: `
    You are a document analyst. Respond ONLY with a valid JSON object:
    {
      "title": "<inferred title>",
      "keyPoints": ["<point 1>", "..."],
      "sentiment": "<positive|neutral|negative>",
      "wordCount": <number>
    }
  `,

  buildContext: async (state) => {
    // Optionally inject RAG context, metadata, or formatting hints
    return `Document word count hint: ~${state.userPrompt.split(' ').length} words`;
  },

  parseResponse: async (text) => {
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned) as SummaryResult;
  },

  onComplete: async (result, state) => {
    console.log(`Summarized in ${state.duration}ms`);
    console.log('Title:', result.title);
    console.log('Key points:', result.keyPoints);
  },

  modelProvider: ModelProvider.claude,
  modelName:     ModelName.CLAUDE_SONNET,
  maxRetries:    2,
}, eventCache, eventBus);

const context  = { threadId: 'sum-001', jobId: 'batch-1', userId: 'user-42' };
const document = `TypeScript is a typed superset of JavaScript...`;

const result = await summaryWorkflow.run(document, context);

if (result.success) {
  console.log(result.state.result);
  // { title: '...', keyPoints: [...], sentiment: 'positive', wordCount: 342 }
} else {
  console.error('Failed:', result.error);
}
```

### Multi-Provider Fallback

Tries Claude first, falls back to OpenAI if the primary fails.

```typescript
import { createLLMWorkflow, LLMProviderFactory, ModelProvider, ModelName } from '@rhythmiclab/rhythmicflow';

LLMProviderFactory.configure({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  openaiApiKey:    process.env.OPENAI_API_KEY!,
});

const primary  = createLLMWorkflow({
  systemPrompt:  'You are a helpful assistant.',
  modelProvider: ModelProvider.claude,
  modelName:     ModelName.CLAUDE_SONNET,
  maxRetries:    1,
}, eventCache, eventBus);

const fallback = createLLMWorkflow({
  systemPrompt:  'You are a helpful assistant.',
  modelProvider: ModelProvider.openai,
  modelName:     ModelName.GPT_4O,
}, eventCache, eventBus);

async function ask(prompt: string, threadId: string): Promise<string> {
  const ctx = { threadId, jobId: 'qa', userId: 'system' };
  let result = await primary.run(prompt, ctx);
  if (!result.success) {
    result = await fallback.run(prompt, { ...ctx, threadId: `${threadId}-fb` });
  }
  return String(result.state.result ?? result.error);
}

const answer = await ask('Explain async/await in one sentence.', 'q-1');
console.log(answer);
```

---

## Data Ingestion Workflow

### API → Database ETL

Fetches paginated records from an HTTP API, validates them, and upserts to a database.

```typescript
import { createDataIngestionWorkflow } from '@rhythmiclab/rhythmicflow';

interface ApiSource  { endpoint: string; page: number; }
interface RawRecord  { id: string; name: string; email: string; createdAt: string; }
interface User       { id: string; name: string; email: string; createdAt: Date; }

const ingestionWorkflow = createDataIngestionWorkflow<ApiSource, RawRecord, User>({
  discover: async () => {
    const res = await fetch('https://api.example.com/users/count');
    const { total } = await res.json() as { total: number };
    const pageSize = 100;
    return Array.from({ length: Math.ceil(total / pageSize) }, (_, i) => ({
      endpoint: 'https://api.example.com/users',
      page: i + 1,
    }));
  },

  fetch: async (sources) => {
    const pages = await Promise.all(
      sources.map(({ endpoint, page }) =>
        fetch(`${endpoint}?page=${page}&limit=100`)
          .then(r => r.json() as Promise<{ data: RawRecord[] }>)
          .then(r => r.data)
      )
    );
    return pages.flat();
  },

  transform: async (rawRecords) =>
    rawRecords.map(r => ({
      id:        r.id,
      name:      r.name.trim(),
      email:     r.email.toLowerCase(),
      createdAt: new Date(r.createdAt),
    })),

  validate: async (users) => {
    const errors = users
      .filter(u => !u.email.includes('@'))
      .map(u => `Invalid email for ${u.id}`);
    return { valid: errors.length === 0, errors, warnings: [], recordCount: users.length };
  },

  load: async (users) => {
    // await db.users.upsertMany(users);
    console.log(`Loaded ${users.length} users`);
    return { loaded: users.length, failed: 0, duration: Date.now() };
  },

  loadOnValidationError: false,
  maxRetries: 3,
}, eventCache, eventBus);

const result = await ingestionWorkflow.run({
  threadId: 'ingest-001',
  jobId:    'nightly-sync',
  userId:   'cron',
});

console.log(`Ingested ${result.state.loadResult?.loaded} records`);
console.log(`Validation: ${result.state.validationResult?.valid ? 'OK' : 'FAILED'}`);
```

### File-Based CSV Ingestion

Reads sensor CSV files from disk, parses and validates them, then loads to storage.

```typescript
import { createDataIngestionWorkflow } from '@rhythmiclab/rhythmicflow';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface CsvFile   { path: string; name: string; }
interface CsvRow    { [key: string]: string; }
interface Sensor    { timestamp: Date; value: number; sensor: string; }

function parseCsv(content: string): CsvRow[] {
  const [header, ...rows] = content.trim().split('\n');
  const keys = header.split(',');
  return rows.map(row => Object.fromEntries(row.split(',').map((v, i) => [keys[i], v])));
}

const csvWorkflow = createDataIngestionWorkflow<CsvFile, CsvRow, Sensor>({
  discover: async () => {
    const dir   = './data/sensors';
    const files = await readdir(dir);
    return files.filter(f => f.endsWith('.csv')).map(name => ({ path: join(dir, name), name }));
  },

  fetch: async (files) => {
    const all = await Promise.all(
      files.map(f => readFile(f.path, 'utf8').then(c => parseCsv(c)))
    );
    return all.flat();
  },

  transform: async (rows) =>
    rows
      .filter(r => r.timestamp && r.value)
      .map(r => ({
        timestamp: new Date(r.timestamp),
        value:     parseFloat(r.value),
        sensor:    r.sensor ?? 'unknown',
      })),

  validate: async (rows) => {
    const invalid = rows.filter(r => isNaN(r.value) || isNaN(r.timestamp.getTime()));
    return {
      valid:       invalid.length === 0,
      errors:      invalid.map(r => `Bad row: ${JSON.stringify(r)}`),
      warnings:    [],
      recordCount: rows.length,
    };
  },

  load: async (rows) => {
    // await db.sensorReadings.insertMany(rows);
    return { loaded: rows.length, failed: 0, duration: 0 };
  },
}, eventCache, eventBus);

const result = await csvWorkflow.run({ threadId: 'csv-001', jobId: 'sensor-import', userId: 'etl' });
console.log('Records loaded:', result.state.loadResult?.loaded);
```

---

## General Workflow

### Order Processing Pipeline

A multi-step order fulfillment workflow with typed steps and custom state.

```typescript
import { WorkflowBuilder } from '@rhythmiclab/rhythmicflow';

type OrderStep =
  | 'validate_order'
  | 'reserve_inventory'
  | 'charge_payment'
  | 'create_shipment'
  | 'notify_customer'
  | 'done';

interface OrderState {
  orderId:        string;
  items:          Array<{ sku: string; qty: number; price: number }>;
  customerId:     string;
  reservationId?: string;
  paymentId?:     string;
  shipmentId?:    string;
  totalCharged?:  number;
}

const orderWorkflow = new WorkflowBuilder<OrderState, OrderStep>()
  .steps(['validate_order', 'reserve_inventory', 'charge_payment', 'create_shipment', 'notify_customer', 'done'])
  .initialStep('validate_order')
  .terminalSteps(['done'])
  .withData({ orderId: '', items: [], customerId: '' })
  .withMaxRetries(2)

  .handle('validate_order', async (state) => {
    if (!state.data.items.length)               throw new Error('Order has no items');
    if (state.data.items.some(i => i.qty <= 0)) throw new Error('Invalid quantity');
    return state;
  })

  .handle('reserve_inventory', async (state) => {
    // await inventoryService.reserve(state.data.items);
    return { ...state, data: { ...state.data, reservationId: `res-${state.data.orderId}` } };
  })

  .handle('charge_payment', async (state) => {
    const total = state.data.items.reduce((s, i) => s + i.price * i.qty, 0);
    // await paymentService.charge(state.data.customerId, total);
    return { ...state, data: { ...state.data, paymentId: `pay-${state.data.orderId}`, totalCharged: total } };
  })

  .handle('create_shipment', async (state) => {
    // await shippingService.create(state.data.orderId, state.data.items);
    return { ...state, data: { ...state.data, shipmentId: `ship-${state.data.orderId}` } };
  })

  .handle('notify_customer', async (state) => {
    // await emailService.send(state.data.customerId, 'order_shipped', state.data);
    console.log(`Customer ${state.data.customerId} notified — shipment ${state.data.shipmentId}`);
    return state;
  })

  .handle('done', async (state) => state)
  .build(eventCache, eventBus);

const result = await orderWorkflow.run({ threadId: 'order-789', jobId: 'order-789', userId: 'customer-42' });

if (result.success) {
  console.log(`Fulfilled — payment: ${result.state.data.paymentId}, shipment: ${result.state.data.shipmentId}`);
} else {
  console.error('Order failed:', result.error);
}
```

### Document Approval with Linear Gates

Each step acts as a gate; throwing an error stops the workflow (retried up to `maxRetries` before failing).

```typescript
import { WorkflowBuilder } from '@rhythmiclab/rhythmicflow';

type ApprovalStep = 'submit' | 'peer_review' | 'legal_check' | 'approve' | 'done';

interface ApprovalState {
  documentId:     string;
  authorId:       string;
  reviewNotes?:   string;
  legalApproved?: boolean;
  approved?:      boolean;
}

const approvalWorkflow = new WorkflowBuilder<ApprovalState, ApprovalStep>()
  .steps(['submit', 'peer_review', 'legal_check', 'approve', 'done'])
  .initialStep('submit')
  .terminalSteps(['done'])
  .withData({ documentId: '', authorId: '' })

  .handle('submit', async (state) => {
    console.log(`Document ${state.data.documentId} submitted`);
    return state;
  })

  .handle('peer_review', async (state) => {
    // const decision = await reviewService.getDecision(state.data.documentId);
    const decision = { approved: true, notes: 'LGTM' };
    if (!decision.approved) throw new Error(`Review rejected: ${decision.notes}`);
    return { ...state, data: { ...state.data, reviewNotes: decision.notes } };
  })

  .handle('legal_check', async (state) => {
    // const ok = await legalService.check(state.data.documentId);
    const ok = true;
    if (!ok) throw new Error('Legal review rejected');
    return { ...state, data: { ...state.data, legalApproved: true } };
  })

  .handle('approve', async (state) => {
    return { ...state, data: { ...state.data, approved: true } };
  })

  .handle('done', async (state) => state)
  .build(eventCache, eventBus);

const result = await approvalWorkflow.run({
  threadId: 'doc-001',
  jobId:    'doc-001',
  userId:   'author-7',
});

console.log(result.success ? 'Approved!' : `Rejected: ${result.error}`);
```

---

## MCP Workflow

### Tool Server with Knowledge Base Search

An MCP WebSocket server exposing search and document retrieval tools.

```typescript
import {
  MCPService,
  ToolRegistry,
  MCPWebSocketServer,
  createToolRegistry,
} from '@rhythmiclab/rhythmicflow';
import type { WorkflowContext } from '@rhythmiclab/rhythmicflow';

const searchTool = {
  name: 'search_knowledge_base',
  description: 'Semantic search over the company knowledge base',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results (default: 5)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>, _ctx: WorkflowContext) => {
    const query = params.query as string;
    const limit = (params.limit as number) ?? 5;
    // await vectorDb.search(query, limit);
    const results = [
      { id: 'doc-1', title: 'Getting Started', score: 0.95 },
    ].slice(0, limit);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      isError: false,
    };
  },
};

const fetchDocTool = {
  name: 'fetch_document',
  description: 'Retrieve the full content of a document by ID',
  inputSchema: {
    type: 'object' as const,
    properties: {
      documentId: { type: 'string', description: 'Document ID' },
    },
    required: ['documentId'],
  },
  handler: async (params: Record<string, unknown>, _ctx: WorkflowContext) => {
    const docId   = params.documentId as string;
    // const content = await cms.getDocument(docId);
    const content = `# Document ${docId}\n\nFull content here...`;
    return {
      content: [{ type: 'text' as const, text: content }],
      isError: false,
    };
  },
};

const registry   = createToolRegistry([searchTool, fetchDocTool]);
const mcpService = new MCPService(registry, eventCache, eventBus);
const wsServer   = new MCPWebSocketServer(mcpService, { port: 3001 });

await wsServer.start();
console.log('MCP server listening on ws://localhost:3001');

// Register additional tools at runtime
mcpService.registerTool({
  name:        'ping',
  description: 'Health check',
  inputSchema: { type: 'object', properties: {}, required: [] },
  handler:     async () => ({ content: [{ type: 'text', text: 'pong' }], isError: false }),
});
```

### Embedded MCP (In-Process Tool Calling)

Use `MCPWorkflow` directly without WebSocket for in-process tool execution.

```typescript
import { MCPWorkflow } from '@rhythmiclab/rhythmicflow';

const workflow = new MCPWorkflow(eventCache, eventBus);

workflow.registerTool(
  'calculate',
  'Evaluate a simple arithmetic expression',
  {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression'],
  },
  async (params) => {
    // Use Function constructor for safer eval than eval()
    const result = Function(`"use strict"; return (${params.expression as string})`)();
    return { content: [{ type: 'text', text: String(result) }], isError: false };
  }
);

const sessionId = 'session-001';

const response = await workflow.processMessage(sessionId, {
  type:      'request',
  method:    'tools/call',
  id:        1,
  params:    { name: 'calculate', arguments: { expression: '6 * 7' } },
  timestamp: new Date().toISOString(),
});

console.log(response);
// [{ type: 'response', result: { content: [{ type: 'text', text: '42' }] } }]
```

---

## Scheduled Workflow

### Hourly Metrics Collection

Collects system metrics every hour with typed payload and alert on failure.

```typescript
import { ScheduledWorkflowEngine } from '@rhythmiclab/rhythmicflow';
import { EventCache, EventBus } from '@rhythmiclab/rhythmic-events';

const eventCache = new EventCache({ maxSize: 500, ttl: 3_600_000 });
const eventBus   = new EventBus({ enableCache: false });
const scheduler  = new ScheduledWorkflowEngine(eventBus, eventCache);

interface MetricsPayload { services: string[]; region: string; }
interface MetricsResult  { collected: number; errors: string[]; }

const scheduleId = await scheduler.schedule<MetricsPayload>(
  {
    cronExpression:   '0 * * * *',
    startImmediately: true,
    payload: {
      services: ['api-gateway', 'auth-service', 'billing-service'],
      region:   'us-east-1',
    },
  },
  {
    validate: async (tick) => {
      if (!tick.payload?.services.length) throw new Error('No services configured');
    },

    execute: async (tick): Promise<MetricsResult> => {
      const { services, region } = tick.payload!;
      const errors: string[] = [];
      let collected = 0;

      await Promise.all(services.map(async (svc) => {
        try {
          // const metrics = await metricsService.collect(svc);
          // await tsdb.insert({ service: svc, region, ...metrics, ts: new Date(tick.scheduledAt) });
          collected++;
        } catch (err) {
          errors.push(`${svc}: ${(err as Error).message}`);
        }
      }));

      return { collected, errors };
    },

    onComplete: async (result, state) => {
      const r = result as MetricsResult;
      console.log(`Tick ${state.tickNumber}: ${r.collected}/${state.payload?.services.length} collected`);
      if (r.errors.length) console.warn('Partial failure:', r.errors);
    },

    onError: async (err, state) => {
      console.error(`Metrics tick ${state.tickNumber} failed:`, err.message);
      // await alerting.fire('metrics-collection-failed', err.message);
    },
  },
);

process.on('SIGTERM', () => { scheduler.cleanup(); process.exit(0); });
```

### Nightly Sync with Auditable Thread IDs

Uses `contextFactory` so every nightly run gets a stable, date-stamped `threadId` for traceability in the checkpointer.

```typescript
import { ScheduledWorkflowEngine } from '@rhythmiclab/rhythmicflow';
import { EventCache, EventBus } from '@rhythmiclab/rhythmic-events';

const scheduler = new ScheduledWorkflowEngine(
  new EventBus({ enableCache: false }),
  new EventCache({ maxSize: 200, ttl: 86_400_000 }),
);

interface SyncPayload { sourceSystem: string; targetSystem: string; entityType: string; }

await scheduler.schedule<SyncPayload>(
  {
    cronExpression: '0 2 * * *',
    scheduleId:     'nightly-sync',
    payload: { sourceSystem: 'crm', targetSystem: 'data-warehouse', entityType: 'contacts' },
  },
  {
    // Stable threadId lets you resume or inspect any nightly run by date
    contextFactory: (tick) => ({
      threadId: `sync:${tick.payload?.entityType}:${tick.scheduledAt.slice(0, 10)}`,
      jobId:    'nightly-sync',
      userId:   'scheduler',
    }),

    execute: async (tick) => {
      const { sourceSystem, targetSystem, entityType } = tick.payload!;
      console.log(`Syncing ${entityType}: ${sourceSystem} → ${targetSystem}`);
      // const count = await syncService.run(tick.payload);
      return { syncedCount: 0, ranAt: tick.scheduledAt };
    },

    onComplete: async (result, state) => {
      const { syncedCount } = result as { syncedCount: number };
      console.log(`Nightly sync complete: ${syncedCount} ${state.payload?.entityType} synced`);
    },

    onError: async (err, state) => {
      console.error(`Sync failed at tick ${state.tickNumber}:`, err.message);
      // await pagerduty.trigger(`nightly-sync-failed`, err.message);
    },
  },
);
```

### Multiple Cadences — Dashboard Refresh

Different UI components refreshed at different intervals, all managed by one engine instance.

```typescript
import { ScheduledWorkflowEngine } from '@rhythmiclab/rhythmicflow';
import { EventCache, EventBus } from '@rhythmiclab/rhythmic-events';

const scheduler = new ScheduledWorkflowEngine(
  new EventBus({ enableCache: false }),
  new EventCache({ maxSize: 100, ttl: 3_600_000 }),
);

// Every minute: real-time stats widget
await scheduler.schedule(
  { cronExpression: '* * * * *', scheduleId: 'rt-widget' },
  {
    execute: async () => {
      // await cache.set('rt-widget', await fetchLatestStats());
      return 'refreshed';
    },
  },
);

// Midnight: rebuild daily summary report
await scheduler.schedule(
  { cronExpression: '0 0 * * *', scheduleId: 'daily-summary' },
  {
    execute: async (tick) => {
      // await reportService.build(tick.scheduledAt);
      return 'daily-summary-built';
    },
    onComplete: async (_r, state) => {
      console.log(`Daily summary ready — tick #${state.tickNumber}`);
    },
  },
);

// Sunday 03:00: purge old records
await scheduler.schedule(
  { cronExpression: '0 3 * * 0', scheduleId: 'weekly-cleanup' },
  {
    execute: async () => {
      // await db.purgeOlderThan(30 /* days */);
      return 'cleanup-done';
    },
  },
);

// Inspect
console.log('Active:', scheduler.listSchedules().map(s => `${s.scheduleId}(${s.status})`));

// Pause/resume
scheduler.stop('weekly-cleanup');
scheduler.start('weekly-cleanup');

// Remove permanently
scheduler.unschedule('rt-widget');

// Tear down everything on exit
process.on('SIGTERM', () => scheduler.cleanup());
```

---

## Custom Workflow Archetype

Extend `BaseWorkflow` directly when you need a domain-specific step model that doesn't fit the existing archetypes.

```typescript
import {
  BaseWorkflow,
  Checkpointer,
  WorkflowPubSub,
  BaseWorkflowStatus,
} from '@rhythmiclab/rhythmicflow';
import type {
  BaseWorkflowState,
  StepHandler,
  WorkflowContext,
  WorkflowResult,
} from '@rhythmiclab/rhythmicflow';
import { EventCache, EventBus } from '@rhythmiclab/rhythmic-events';

// ── Steps ─────────────────────────────────────────────────────────────────────

enum EmailStep {
  PREPARING = 'preparing',
  RENDERING = 'rendering',
  SENDING   = 'sending',
  COMPLETED = 'completed',
}

// ── State ─────────────────────────────────────────────────────────────────────

interface EmailWorkflowState extends BaseWorkflowState<EmailStep, BaseWorkflowStatus> {
  to:         string;
  subject:    string;
  template:   string;
  variables:  Record<string, string>;
  html?:      string;
  messageId?: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

interface EmailWorkflowConfig {
  fromAddress: string;
  maxRetries?: number;
  onSent?:     (messageId: string, state: EmailWorkflowState) => Promise<void>;
}

// ── Workflow class ────────────────────────────────────────────────────────────

class EmailWorkflow extends BaseWorkflow<EmailWorkflowState, EmailStep> {
  protected readonly steps: EmailStep[] = [
    EmailStep.PREPARING,
    EmailStep.RENDERING,
    EmailStep.SENDING,
    EmailStep.COMPLETED,
  ];

  protected readonly handlers: Record<EmailStep, StepHandler<EmailWorkflowState>> = {
    [EmailStep.PREPARING]: this.handlePreparing.bind(this),
    [EmailStep.RENDERING]: this.handleRendering.bind(this),
    [EmailStep.SENDING]:   this.handleSending.bind(this),
    [EmailStep.COMPLETED]: (state) => Promise.resolve(state),
  };

  protected readonly initialStep   = EmailStep.PREPARING;
  protected readonly terminalSteps = [EmailStep.COMPLETED];
  protected readonly channelPrefix = 'email';

  constructor(
    private readonly config: EmailWorkflowConfig,
    eventCache: EventCache,
    eventBus: EventBus,
  ) {
    super(
      new Checkpointer<EmailWorkflowState>(eventCache, 'email'),
      new WorkflowPubSub(eventBus),
    );
  }

  async run(
    to: string,
    subject: string,
    template: string,
    variables: Record<string, string>,
    context: WorkflowContext,
  ): Promise<WorkflowResult<EmailWorkflowState>> {
    return this.execute({
      to, subject, template, variables,
      currentStep: EmailStep.PREPARING,
      stepHistory: [],
      status:      BaseWorkflowStatus.PENDING,
      retryCount:  0,
      maxRetries:  this.config.maxRetries ?? 3,
      startTime:   new Date().toISOString(),
    }, context);
  }

  private async handlePreparing(state: EmailWorkflowState): Promise<EmailWorkflowState> {
    if (!state.to.includes('@')) throw new Error(`Invalid recipient: ${state.to}`);
    if (!state.subject)          throw new Error('Subject is required');
    return { ...state, currentStep: EmailStep.RENDERING };
  }

  private async handleRendering(state: EmailWorkflowState): Promise<EmailWorkflowState> {
    const html = Object.entries(state.variables).reduce(
      (tmpl, [k, v]) => tmpl.replaceAll(`{{${k}}}`, v),
      state.template,
    );
    return { ...state, html, currentStep: EmailStep.SENDING };
  }

  private async handleSending(state: EmailWorkflowState): Promise<EmailWorkflowState> {
    // await mailer.send({ from: this.config.fromAddress, to: state.to, subject: state.subject, html: state.html });
    const messageId = `msg-${Date.now()}`;
    await this.config.onSent?.(messageId, state);
    return { ...state, messageId, currentStep: EmailStep.COMPLETED };
  }
}

// ── Usage ─────────────────────────────────────────────────────────────────────

const emailWorkflow = new EmailWorkflow(
  {
    fromAddress: 'noreply@example.com',
    maxRetries:  2,
    onSent: async (messageId) => console.log('Sent:', messageId),
  },
  eventCache,
  eventBus,
);

const result = await emailWorkflow.run(
  'alice@example.com',
  'Welcome to Acme!',
  '<h1>Hi {{name}}, your code is <b>{{code}}</b>.</h1>',
  { name: 'Alice', code: 'ACME2024' },
  { threadId: 'email-001', jobId: 'welcome-batch', userId: 'system' },
);

console.log(result.success ? `Sent: ${result.state.messageId}` : `Failed: ${result.error}`);
```
