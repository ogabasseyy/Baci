import {
  type BillingCounters,
  createEmptyBillingCounters,
  type QuizAttemptResultResponse,
  type QuizLeaderboardApiEntry,
  type QuizLeaderboardApiResponse,
  type QuizMode,
  type QuizPrivateResultRecord,
  type QuizPrizeClaim,
  type QuizResultClaim,
  QuizRoomError,
} from './contracts';
import { QuizControlStateStore } from './control-state';
import { computeShardHashUint32 } from './crypto';
import type { RoomStorageBackend, SqlRow } from './sqlite-adapter';

export interface PublishedShardEventMetadata {
  eventId: string;
  merchantId: string;
  mode: QuizMode;
  eventStatus: 'completed' | 'cancelled';
  publishedAtMs: number;
  endsAtMs: number;
  participantCount: number;
  top100: readonly {
    attemptId: string;
    customerId: string;
    userId: string;
    leaderboardUsername: string;
    rank: number;
    score: number;
    status: string;
    submittedAtMs: number | null;
    totalTimeSeconds: number | null;
  }[];
  retentionExpiresAtMs: number;
}

export interface OriginWinnerAwardPayload {
  claim?: QuizResultClaim;
  prizeClaim?: QuizPrizeClaim;
}

export interface ResultShardHooks {
  /**
   * Called ONLY when `hasAward === true` on `GET /api/quiz/attempts/:attemptId/result`
   * (including post-checkout focus refreshes) so `claim` and `prizeClaim` stay
   * authoritative on the origin database. Never called for ordinary non-winner reads.
   */
  fetchWinnerAwardFromOrigin?: (params: {
    attemptId: string;
    eventId: string;
    userId: string;
    authorizationHeader?: string;
  }) => Promise<OriginWinnerAwardPayload>;
  /**
   * Optional origin recovery path if a returning player reads a result after
   * the edge shard retention period has expired.
   */
  recoverExpiredResultFromOrigin?: (params: {
    attemptId: string;
    userId: string;
    authorizationHeader?: string;
  }) => Promise<QuizAttemptResultResponse>;
}

interface ShardResultRow extends SqlRow {
  event_id: string;
  attempt_id: string;
  merchant_id: string;
  user_id: string;
  customer_id: string;
  leaderboard_username: string;
  rank: number;
  score: number;
  total_questions: number;
  attempt_status: string;
  submitted_at_ms: number;
  total_time_seconds: number;
  has_award: number;
  retention_expires_at_ms: number;
}

interface ShardEventRow extends SqlRow {
  event_id: string;
  metadata_json: string;
}

export async function computeResultShardIndex(
  eventId: string,
  userId: string,
  shardCount: number
): Promise<number> {
  if (!Number.isInteger(shardCount) || shardCount <= 0) {
    throw new QuizRoomError(
      'QUIZ_SHARD_COUNT_INVALID',
      'Shard count must be a positive integer',
      500
    );
  }
  const hash = await computeShardHashUint32(eventId, userId);
  return hash % shardCount;
}

/**
 * SQLite-backed private result shard serving both `GET /api/quiz/attempts/:attemptId/result`
 * and published `GET /api/quiz/leaderboard?eventId=...` for returning players routed by
 * `hash(eventId, userId) mod S`. Works with bearer JWT auth even after play-ticket expiry
 * or device switches, with zero PostgREST calls per ordinary viewer.
 */
export class ResultShardEngine {
  readonly shardIndex: number;
  private readonly storage: RoomStorageBackend;
  private readonly controlState: QuizControlStateStore;
  private readonly hooks: ResultShardHooks;
  private schemaInitialized = false;
  private originCalls = 0;

  constructor(options: {
    shardIndex: number;
    storage: RoomStorageBackend;
    controlState?: QuizControlStateStore;
    hooks?: ResultShardHooks;
  }) {
    this.shardIndex = options.shardIndex;
    this.storage = options.storage;
    this.controlState = options.controlState ?? new QuizControlStateStore();
    this.hooks = options.hooks ?? {};
  }

  private ensureSchemaSync(): void {
    if (this.schemaInitialized) return;
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS shard_published_events (
        event_id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS shard_results (
        event_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        leaderboard_username TEXT NOT NULL,
        rank INTEGER NOT NULL,
        score INTEGER NOT NULL,
        total_questions INTEGER NOT NULL,
        attempt_status TEXT NOT NULL,
        submitted_at_ms INTEGER NOT NULL,
        total_time_seconds REAL NOT NULL,
        has_award INTEGER NOT NULL DEFAULT 0,
        retention_expires_at_ms INTEGER NOT NULL,
        PRIMARY KEY (event_id, attempt_id)
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_shard_results_user
        ON shard_results(event_id, user_id);

      CREATE INDEX IF NOT EXISTS idx_shard_results_attempt
        ON shard_results(attempt_id);
    `);
    this.schemaInitialized = true;
  }

  getOriginCallCount(): number {
    return this.originCalls;
  }

  getBillingCounters(): BillingCounters {
    const sql = this.storage.getBillingTotals();
    return {
      ...createEmptyBillingCounters(),
      rowsRead: sql.rowsRead,
      rowsWritten: sql.rowsWritten,
    };
  }

  resetBillingCounters(): void {
    this.storage.resetBillingTotals();
    this.originCalls = 0;
  }

  materializeResultsBatch(
    eventMeta: PublishedShardEventMetadata,
    records: readonly QuizPrivateResultRecord[]
  ): void {
    this.storage.transactionSync(() => {
      this.ensureSchemaSync();
      this.storage.exec(
        `INSERT INTO shard_published_events (event_id, metadata_json)
         VALUES (?, ?)
         ON CONFLICT(event_id) DO UPDATE SET metadata_json = excluded.metadata_json`,
        eventMeta.eventId,
        JSON.stringify(eventMeta)
      );

      for (const r of records) {
        this.storage.exec(
          `INSERT INTO shard_results (
            event_id, attempt_id, merchant_id, user_id, customer_id,
            leaderboard_username, rank, score, total_questions, attempt_status,
            submitted_at_ms, total_time_seconds, has_award, retention_expires_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id, attempt_id) DO UPDATE SET
            rank = excluded.rank,
            score = excluded.score,
            attempt_status = excluded.attempt_status,
            has_award = excluded.has_award,
            retention_expires_at_ms = excluded.retention_expires_at_ms`,
          r.eventId,
          r.attemptId,
          r.merchantId,
          r.userId,
          r.customerId,
          r.leaderboardUsername.trim(),
          r.rank,
          r.score,
          r.totalQuestions,
          r.attemptStatus,
          r.submittedAtMs,
          r.totalTimeSeconds,
          r.hasAward ? 1 : 0,
          r.retentionExpiresAtMs
        );
      }
    });
  }

  /**
   * Handles `GET /api/quiz/attempts/:attemptId/result` authenticated by bearer JWT.
   * Does NOT require a play ticket or original deviceHash.
   * Zero origin/PostgREST calls for ordinary non-winner viewers (`hasAward === false`).
   */
  getEventIdForAttempt(attemptId: string): string | null {
    this.ensureSchemaSync();
    const row = this.storage.exec<{ event_id: string }>(
      `SELECT event_id FROM shard_results WHERE attempt_id = ?`,
      attemptId
    ).rows[0];
    return row?.event_id ?? null;
  }

  async getAttemptResult(params: {
    attemptId: string;
    callerUserId: string;
    nowMs?: number;
    authorizationHeader?: string;
    pendingEventEndsAtMs?: number | null;
  }): Promise<QuizAttemptResultResponse> {
    this.ensureSchemaSync();
    const nowMs = params.nowMs ?? Date.now();

    const row = this.storage.exec<ShardResultRow>(
      `SELECT * FROM shard_results WHERE attempt_id = ?`,
      params.attemptId
    ).rows[0];

    if (!row) {
      if (this.hooks.recoverExpiredResultFromOrigin) {
        this.originCalls += 1;
        return this.hooks.recoverExpiredResultFromOrigin({
          attemptId: params.attemptId,
          userId: params.callerUserId,
          authorizationHeader: params.authorizationHeader,
        });
      }
      if (params.pendingEventEndsAtMs !== undefined) {
        return {
          attemptId: params.attemptId,
          availability: 'pending',
          availableAt:
            params.pendingEventEndsAtMs !== null
              ? new Date(params.pendingEventEndsAtMs).toISOString()
              : null,
        };
      }
      return {
        attemptId: params.attemptId,
        availability: 'unavailable',
        reason: 'not_found',
      };
    }

    if (
      row.user_id !== params.callerUserId ||
      this.controlState.isCustomerDeleted(row.customer_id)
    ) {
      return {
        attemptId: params.attemptId,
        availability: 'unavailable',
        reason: 'not_found',
      };
    }

    const eventRow = this.storage.exec<ShardEventRow>(
      `SELECT event_id, metadata_json FROM shard_published_events WHERE event_id = ?`,
      row.event_id
    ).rows[0];
    const eventMeta = eventRow
      ? (JSON.parse(eventRow.metadata_json) as PublishedShardEventMetadata)
      : null;

    if (
      this.controlState.isEventCancelled(row.event_id) ||
      eventMeta?.eventStatus === 'cancelled'
    ) {
      return {
        attemptId: row.attempt_id,
        availability: 'unavailable',
        reason: 'event_cancelled',
      };
    }

    if (this.controlState.isTesterRevoked(row.event_id, params.callerUserId)) {
      return {
        attemptId: row.attempt_id,
        availability: 'unavailable',
        reason: 'tester_revoked',
      };
    }

    if (
      this.controlState.isAttemptBlocked(
        row.event_id,
        row.attempt_id,
        row.customer_id
      ) ||
      this.controlState.isAttemptDisqualified(row.attempt_id)
    ) {
      return {
        attemptId: row.attempt_id,
        availability: 'unavailable',
      };
    }

    if (!eventMeta) {
      return {
        attemptId: row.attempt_id,
        availability: 'pending',
        availableAt:
          params.pendingEventEndsAtMs !== undefined &&
          params.pendingEventEndsAtMs !== null
            ? new Date(params.pendingEventEndsAtMs).toISOString()
            : null,
      };
    }

    if (nowMs >= row.retention_expires_at_ms) {
      this.storage.exec(
        `DELETE FROM shard_results WHERE attempt_id = ?`,
        row.attempt_id
      );
      if (this.hooks.recoverExpiredResultFromOrigin) {
        this.originCalls += 1;
        return this.hooks.recoverExpiredResultFromOrigin({
          attemptId: row.attempt_id,
          userId: params.callerUserId,
          authorizationHeader: params.authorizationHeader,
        });
      }
      throw new QuizRoomError('QZ004', 'quiz_attempt_not_found', 404);
    }

    let claim: QuizResultClaim | undefined;
    let prizeClaim: QuizPrizeClaim | undefined;
    if (row.has_award === 1) {
      if (!this.hooks.fetchWinnerAwardFromOrigin) {
        throw new QuizRoomError(
          'QUIZ_WINNER_ORIGIN_REQUIRED',
          'Winner award lookup requires authenticated origin fetcher',
          503
        );
      }
      this.originCalls += 1;
      const originAward = await this.hooks.fetchWinnerAwardFromOrigin({
        attemptId: row.attempt_id,
        eventId: row.event_id,
        userId: params.callerUserId,
        authorizationHeader: params.authorizationHeader,
      });
      claim = originAward.claim;
      prizeClaim = originAward.prizeClaim;
    }

    return {
      attemptId: row.attempt_id,
      availability: 'final',
      availableAt: new Date(eventMeta.publishedAtMs).toISOString(),
      score: row.score,
      rank: row.rank,
      totalQuestions: row.total_questions,
      ...(claim ? { claim } : {}),
      ...(prizeClaim ? { prizeClaim } : {}),
    };
  }

  /**
   * Serves published `GET /api/quiz/leaderboard?eventId=...` (`top-100` + `currentPlayer`)
   * directly from the player's deterministic shard with zero PostgREST calls.
   */
  async getPublishedLeaderboard(params: {
    eventId: string;
    callerUserId: string;
    callerCustomerId?: string;
    callerMerchantId?: string;
  }): Promise<QuizLeaderboardApiResponse> {
    this.ensureSchemaSync();
    if (this.controlState.isEventCancelled(params.eventId)) {
      return {
        status: 'unavailable',
        entries: [],
        currentPlayer: null,
        participantCount: null,
      };
    }

    const eventRow = this.storage.exec<ShardEventRow>(
      `SELECT event_id, metadata_json FROM shard_published_events WHERE event_id = ?`,
      params.eventId
    ).rows[0];
    if (!eventRow) {
      return {
        status: 'live_hidden',
        entries: [],
        currentPlayer: null,
        participantCount: null,
      };
    }

    const eventMeta = JSON.parse(
      eventRow.metadata_json
    ) as PublishedShardEventMetadata;

    if (
      params.callerMerchantId &&
      eventMeta.merchantId !== params.callerMerchantId
    ) {
      throw new QuizRoomError('QZ031', 'not_authorized', 403);
    }
    if (
      eventMeta.mode === 'test' &&
      this.controlState.isTesterRevoked(params.eventId, params.callerUserId)
    ) {
      throw new QuizRoomError('QZ031', 'not_authorized', 403);
    }
    if (eventMeta.eventStatus === 'cancelled') {
      return {
        status: 'unavailable',
        entries: [],
        currentPlayer: null,
        participantCount: null,
      };
    }

    const callerRows = this.storage.exec<ShardResultRow>(
      `SELECT * FROM shard_results WHERE event_id = ? AND user_id = ? ORDER BY rank ASC LIMIT 1`,
      params.eventId,
      params.callerUserId
    ).rows;
    const callerRow = callerRows[0];
    const resolvedCustomerId =
      callerRow?.customer_id ?? params.callerCustomerId ?? '';

    const entries: QuizLeaderboardApiEntry[] = [];
    let callerInTop = false;

    for (const item of eventMeta.top100) {
      const displayName = await this.controlState.resolveDisplayName(
        params.eventId,
        item.attemptId,
        item.customerId,
        item.leaderboardUsername
      );
      const isCurrentCustomer =
        item.userId === params.callerUserId ||
        (resolvedCustomerId.length > 0 &&
          item.customerId === resolvedCustomerId);
      if (isCurrentCustomer) callerInTop = true;

      entries.push({
        displayName,
        isCurrentCustomer,
        rank: item.rank,
        score: item.score,
        status: item.status,
        submittedAt:
          item.submittedAtMs !== null
            ? new Date(item.submittedAtMs).toISOString()
            : null,
        totalTimeSeconds: item.totalTimeSeconds,
      });
    }

    let currentPlayer: QuizLeaderboardApiEntry | null = null;
    if (!callerInTop && callerRow && callerRow.rank > 100) {
      const displayName = await this.controlState.resolveDisplayName(
        params.eventId,
        callerRow.attempt_id,
        callerRow.customer_id,
        callerRow.leaderboard_username
      );
      currentPlayer = {
        displayName,
        isCurrentCustomer: true,
        rank: callerRow.rank,
        score: callerRow.score,
        status: callerRow.attempt_status,
        submittedAt: new Date(callerRow.submitted_at_ms).toISOString(),
        totalTimeSeconds: callerRow.total_time_seconds,
      };
    }

    return {
      status: 'published',
      entries,
      currentPlayer,
      participantCount: eventMeta.participantCount,
    };
  }

  /**
   * Guarded cleanup: refuses to wipe shard data until all events on this shard
   * have passed `retention_expires_at_ms`.
   */
  deleteAllIfRetentionExpired(nowMs = Date.now()): void {
    this.ensureSchemaSync();
    const minRow = this.storage.exec<{ max_ret: number | null }>(
      `SELECT MAX(retention_expires_at_ms) AS max_ret FROM shard_results`
    ).rows[0];
    const maxRet = minRow?.max_ret;
    if (maxRet !== null && maxRet !== undefined && nowMs < maxRet) {
      throw new QuizRoomError(
        'QUIZ_SHARD_RETENTION_NOT_EXPIRED',
        `Cannot deleteAll() on shard ${this.shardIndex} before retention expires at ${maxRet}`,
        409
      );
    }
    this.storage.deleteAll();
    this.schemaInitialized = false;
  }
}
