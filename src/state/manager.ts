/**
 * @stub StateManager — placeholder awaiting implementation.
 *
 * Intended to provide a higher-level key/value abstraction over Redis,
 * backed by @kubegram/events EventCache with TTL management and
 * cache invalidation. Currently all workflow state is managed directly by
 * RedisCheckpointer. This class will wrap that when implemented.
 *
 * Do not use this class — use RedisCheckpointer directly instead.
 */

export interface StateConfig {
  redisHost?: string;
  redisPort?: number;
  redisDb?: number;
}

export class StateManager {
  private config: StateConfig;

  constructor(config: StateConfig = {}) {
    this.config = config;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  async get(_key: string): Promise<any> {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  async set(_key: string, _value: any, _ttl?: number): Promise<void> {}
}

export const stateManager = new StateManager();
