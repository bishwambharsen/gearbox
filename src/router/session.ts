// Bounded per-session router state. Insertion-ordered Map = FIFO eviction of the
// oldest session once the cap is reached.
import type { ModelTier } from '../types.js';

export interface SessionState {
  gear: ModelTier;
  failures: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private readonly defaultTier: ModelTier,
    private readonly maxSessions = 1000,
  ) {}

  get(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (state) return state;
    state = { gear: this.defaultTier, failures: 0 };
    this.sessions.set(sessionId, state);
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    return state;
  }

  get size(): number {
    return this.sessions.size;
  }
}
