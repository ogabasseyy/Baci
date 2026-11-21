import { type QuizControlStateSnapshot, QuizRoomError } from './contracts';
import { quizPublicLeaderboardAlias } from './crypto';

/**
 * Default control-state freshness bound (< 60 seconds).
 * New starts are suspended whenever `nowMs - state.updatedAtMs >= maxAgeMs`.
 */
export const DEFAULT_CONTROL_STATE_MAX_AGE_MS = 60_000;

export function makeEventScopedKey(eventId: string, subjectId: string): string {
  return `${eventId}:${subjectId}`;
}

export function createEmptyControlState(
  updatedAtMs = 0,
  version = 1
): QuizControlStateSnapshot {
  return {
    version,
    updatedAtMs,
    cancelledEvents: {},
    blockedAttemptIds: [],
    blockedCustomerKeys: [],
    revokedTesterKeys: [],
    disqualifiedAttemptIds: [],
    suppressedAttemptIds: [],
    deletedCustomerIds: [],
    publishedEvents: {},
  };
}

export function isControlStateFresh(
  state: QuizControlStateSnapshot,
  nowMs: number,
  maxAgeMs = DEFAULT_CONTROL_STATE_MAX_AGE_MS
): boolean {
  return nowMs >= state.updatedAtMs && nowMs - state.updatedAtMs < maxAgeMs;
}

export class QuizControlStateStore {
  private snapshot: QuizControlStateSnapshot;
  private blockedAttempts: Set<string>;
  private blockedCustomers: Set<string>;
  private revokedTesters: Set<string>;
  private disqualifiedAttempts: Set<string>;
  private suppressedAttempts: Set<string>;
  private deletedCustomers: Set<string>;
  private readonly maxAgeMs: number;

  constructor(
    initial?: QuizControlStateSnapshot,
    maxAgeMs = DEFAULT_CONTROL_STATE_MAX_AGE_MS
  ) {
    this.maxAgeMs = maxAgeMs;
    this.snapshot = initial ?? createEmptyControlState(0, 0);
    this.blockedAttempts = new Set(this.snapshot.blockedAttemptIds);
    this.blockedCustomers = new Set(this.snapshot.blockedCustomerKeys);
    this.revokedTesters = new Set(this.snapshot.revokedTesterKeys);
    this.disqualifiedAttempts = new Set(this.snapshot.disqualifiedAttemptIds);
    this.suppressedAttempts = new Set(this.snapshot.suppressedAttemptIds);
    this.deletedCustomers = new Set(this.snapshot.deletedCustomerIds);
  }

  getVersion(): number {
    return this.snapshot.version;
  }

  getUpdatedAtMs(): number {
    return this.snapshot.updatedAtMs;
  }

  getSnapshot(): QuizControlStateSnapshot {
    return this.snapshot;
  }

  /**
   * Applies a newer control-state version monotonically. Older versions are ignored.
   * Returns true if applied.
   */
  applySnapshot(next: QuizControlStateSnapshot): boolean {
    if (next.version < this.snapshot.version) {
      return false;
    }
    if (
      next.version === this.snapshot.version &&
      next.updatedAtMs <= this.snapshot.updatedAtMs
    ) {
      return false;
    }
    this.snapshot = next;
    this.blockedAttempts = new Set(next.blockedAttemptIds);
    this.blockedCustomers = new Set(next.blockedCustomerKeys);
    this.revokedTesters = new Set(next.revokedTesterKeys);
    this.disqualifiedAttempts = new Set(next.disqualifiedAttemptIds);
    this.suppressedAttempts = new Set(next.suppressedAttemptIds);
    this.deletedCustomers = new Set(next.deletedCustomerIds);
    return true;
  }

  isFresh(nowMs: number): boolean {
    return isControlStateFresh(this.snapshot, nowMs, this.maxAgeMs);
  }

  assertFreshForNewStart(nowMs: number): void {
    if (!this.isFresh(nowMs)) {
      throw new QuizRoomError(
        'QUIZ_CONTROL_STATE_STALE',
        'Quiz control state is stale; new starts suspended',
        503
      );
    }
  }

  isEventCancelled(eventId: string): boolean {
    return Boolean(this.snapshot.cancelledEvents[eventId]);
  }

  getPublishedEvent(eventId: string): {
    publishedAtMs: number;
    eventStatus: 'completed' | 'cancelled';
    manifestChecksumSha256?: string;
  } | null {
    return this.snapshot.publishedEvents[eventId] ?? null;
  }

  isTesterRevoked(eventId: string, userId: string): boolean {
    return this.revokedTesters.has(makeEventScopedKey(eventId, userId));
  }

  isAttemptBlocked(
    eventId: string,
    attemptId: string,
    customerId?: string
  ): boolean {
    if (this.blockedAttempts.has(attemptId)) return true;
    if (
      customerId &&
      this.blockedCustomers.has(makeEventScopedKey(eventId, customerId))
    ) {
      return true;
    }
    return false;
  }

  isAttemptDisqualified(attemptId: string): boolean {
    return this.disqualifiedAttempts.has(attemptId);
  }

  isIdentitySuppressed(attemptId: string, customerId: string): boolean {
    return (
      this.suppressedAttempts.has(attemptId) ||
      this.deletedCustomers.has(customerId)
    );
  }

  isCustomerDeleted(customerId: string): boolean {
    return this.deletedCustomers.has(customerId);
  }

  resolveDisplayName(
    eventId: string,
    attemptId: string,
    customerId: string,
    leaderboardUsername: string
  ): Promise<string> {
    const trimmed = leaderboardUsername.trim();
    if (
      trimmed.length === 0 ||
      this.isIdentitySuppressed(attemptId, customerId)
    ) {
      return quizPublicLeaderboardAlias(eventId, customerId);
    }
    return Promise.resolve(trimmed);
  }
}
