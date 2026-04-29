/**
 * Checkpointer for workflow state persistence
 * Uses EventCache via constructor injection (no Redis dependency).
 */

import { DomainEvent, EventCache } from "@rhythmiclab/rhythmic-events";
import { BaseWorkflowState } from "./workflow";

// Checkpoint status interface
export interface CheckpointStatus {
  threadId: string;
  step: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  totalSteps?: number;
  currentStep?: number;
  error?: string;
}

// Checkpoint metadata interface
export type CheckpointMetadata = CheckpointStatus;

export class CheckpointEvent<T extends BaseWorkflowState> extends DomainEvent<
  CheckpointStatus | T
> {
  constructor(
    threadId: string,
    type: "status" | "state",
    data: CheckpointStatus | T,
    keyPrefix: string = "checkpoint",
  ) {
    super(
      `${keyPrefix}:${type}`,
      `${keyPrefix}:${type}:${threadId}`,
      data,
      threadId,
    );
  }
}

/**
 * EventCache-backed checkpointer for workflow state management.
 * Accepts an EventCache instance via the constructor — callers are responsible
 * for creating and configuring the EventCache.
 *
 * Key layout (event IDs):
 *   {keyPrefix}:state:{threadId}   — full state snapshot
 *   {keyPrefix}:status:{threadId}  — lightweight status-only record
 *
 * Event types:
 *   {keyPrefix}:state   — used to filter state events
 *   {keyPrefix}:status  — used to filter status events (listThreads)
 */
export class Checkpointer<T extends BaseWorkflowState> {
  constructor(
    private readonly eventCache: EventCache,
    private readonly keyPrefix: string = "checkpoint",
  ) {}

  /**
   * Save workflow state with metadata.
   */
  async save(
    threadId: string,
    state: T,
    step: string,
    status: CheckpointStatus["status"] = "running",
    metadata?: Partial<CheckpointMetadata>,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const existingStatus = await this.getStatus(threadId);

      const stateData = {
        state,
        step,
        status,
        updatedAt: timestamp,
        ...metadata,
      };

      const statusData: CheckpointStatus = {
        threadId,
        step,
        status,
        createdAt: existingStatus?.createdAt ?? timestamp,
        updatedAt: timestamp,
        totalSteps: metadata?.totalSteps,
        currentStep: metadata?.currentStep,
      };

      await this.eventCache.add(
        new CheckpointEvent(
          threadId,
          "state",
          stateData as unknown as T,
          this.keyPrefix,
        ),
      );
      await this.eventCache.add(
        new CheckpointEvent(threadId, "status", statusData, this.keyPrefix),
      );
    } catch (error) {
      console.error(`Failed to save checkpoint for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Load workflow state by thread ID.
   */
  async load(threadId: string): Promise<T | null> {
    try {
      const event = await this.eventCache.get(
        `${this.keyPrefix}:state:${threadId}`,
      );
      if (!event) return null;
      return (event.data as { state: T }).state;
    } catch (error) {
      console.error(`Failed to load checkpoint for thread ${threadId}:`, error);
      return null;
    }
  }

  /**
   * Load full checkpoint data including metadata.
   */
  async loadWithMetadata(threadId: string): Promise<{
    state: T;
    step: string;
    status: CheckpointStatus["status"];
    updatedAt: string;
    error?: string;
    metadata?: unknown;
  } | null> {
    try {
      const event = await this.eventCache.get(
        `${this.keyPrefix}:state:${threadId}`,
      );
      if (!event) return null;
      return event.data as {
        state: T;
        step: string;
        status: CheckpointStatus["status"];
        updatedAt: string;
        error?: string;
      };
    } catch (error) {
      console.error(
        `Failed to load checkpoint metadata for thread ${threadId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Get checkpoint status by thread ID.
   */
  async getStatus(threadId: string): Promise<CheckpointStatus | null> {
    try {
      const event = await this.eventCache.get(
        `${this.keyPrefix}:status:${threadId}`,
      );
      if (!event) return null;
      return event.data as CheckpointStatus;
    } catch (error) {
      console.error(
        `Failed to get checkpoint status for thread ${threadId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Update checkpoint status without reloading the full state.
   */
  async updateStatus(
    threadId: string,
    status: CheckpointStatus["status"],
    step?: string,
    error?: string,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const existing = await this.getStatus(threadId);

      const statusData: CheckpointStatus = existing
        ? {
            ...existing,
            status,
            updatedAt: timestamp,
            ...(step && { step }),
            ...(error && { error }),
          }
        : {
            threadId,
            step: step ?? "unknown",
            status,
            createdAt: timestamp,
            updatedAt: timestamp,
            ...(error && { error }),
          };

      await this.eventCache.add(
        new CheckpointEvent(threadId, "status", statusData, this.keyPrefix),
      );
    } catch (error) {
      console.error(
        `Failed to update checkpoint status for thread ${threadId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * List all active thread IDs.
   */
  async listThreads(): Promise<string[]> {
    try {
      const events = await this.eventCache.getEvents({
        eventType: `${this.keyPrefix}:status`,
      });
      return [
        ...new Set(events.map((e) => e.aggregateId).filter(Boolean)),
      ] as string[];
    } catch (error) {
      console.error("Failed to list checkpoint threads:", error);
      return [];
    }
  }

  /**
   * Delete checkpoint by thread ID.
   */
  async delete(threadId: string): Promise<boolean> {
    try {
      const [r1, r2] = await Promise.all([
        this.eventCache.remove(`${this.keyPrefix}:state:${threadId}`),
        this.eventCache.remove(`${this.keyPrefix}:status:${threadId}`),
      ]);
      return r1 || r2;
    } catch (error) {
      console.error(
        `Failed to delete checkpoint for thread ${threadId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Remove expired checkpoints older than maxAge seconds (default: 7 days).
   *
   * Iterates all tracked thread IDs — O(n) on active thread count.
   * Suitable for periodic maintenance tasks; do not call on hot paths.
   */
  async cleanup(maxAge: number = 604800): Promise<number> {
    try {
      const threads = await this.listThreads();
      const cutoff = new Date(Date.now() - maxAge * 1000).toISOString();
      let deleted = 0;
      for (const threadId of threads) {
        const s = await this.getStatus(threadId);
        if (s && s.updatedAt < cutoff) {
          if (await this.delete(threadId)) deleted++;
        }
      }
      return deleted;
    } catch (error) {
      console.error("Failed to cleanup checkpoints:", error);
      return 0;
    }
  }

  /**
   * Get checkpoint statistics.
   */
  async getStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    oldest?: string;
    newest?: string;
  }> {
    try {
      const threads = await this.listThreads();
      const byStatus: Record<string, number> = {};
      let oldest: string | undefined;
      let newest: string | undefined;

      for (const threadId of threads) {
        const s = await this.getStatus(threadId);
        if (s) {
          byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
          if (!oldest || s.createdAt < oldest) oldest = s.createdAt;
          if (!newest || s.createdAt > newest) newest = s.createdAt;
        }
      }

      return { total: threads.length, byStatus, oldest, newest };
    } catch (error) {
      console.error("Failed to get checkpoint stats:", error);
      return { total: 0, byStatus: {} };
    }
  }
}
