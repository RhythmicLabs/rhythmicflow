/**
 * WorkflowPubSub — adapter that bridges BaseWorkflow's pub/sub interface
 * to the @rhythmiclab/rhythmic-events EventBus.
 *
 * BaseWorkflow calls: pubsub.publish(channel, workflowEvent)
 * EventBus expects:  bus.publish(domainEvent)
 *
 * This adapter wraps WorkflowEvent in a concrete DomainEvent subclass.
 */

import { v4 as uuidv4 } from "uuid";
import { DomainEvent, EventBus } from "@rhythmiclab/rhythmic-events";
import type { WorkflowEvent } from "../types/workflow.js";

class WorkflowDomainEvent extends DomainEvent<WorkflowEvent> {
  constructor(channel: string, event: WorkflowEvent) {
    super(`${channel}.${event.type}`, uuidv4(), event, event.workflowId, {
      channel,
      step: event.step,
      error: event.error,
      ...event.metadata,
    });
  }
}

export class WorkflowPubSub {
  constructor(private readonly eventBus: EventBus) {}

  /**
   * Publish a WorkflowEvent through the EventBus.
   *
   * The DomainEvent type field is set to `{channel}.{event.type}` so that
   * subscribers can listen on fine-grained event types
   * (e.g. "codegen:abc123.completed") or wildcard by prefix.
   */
  async publish(channel: string, event: WorkflowEvent): Promise<void> {
    await this.eventBus.publish(new WorkflowDomainEvent(channel, event));
  }
}
