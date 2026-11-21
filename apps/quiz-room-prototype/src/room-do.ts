import {
  computeAttemptBundleChecksumSha256,
  type PackedMessageWithMetrics,
  QuizBatchPacker,
} from './batch-packer';
import {
  type BillingCounters,
  createEmptyBillingCounters,
  type QuizAdmissionTicket,
  type QuizAttemptAnswerTranscript,
  type QuizAttemptBundle,
  type QuizAttemptCloseReason,
  type QuizEventConfig,
  type QuizIntegrityTier,
  type QuizPackedQueueMessage,
  type QuizPlatform,
  type QuizQuestionOption,
  type QuizQuestionVariant,
  QuizRoomError,
  type QuizRoomSealManifest,
  type QuizRoomSealMode,
  type QuizWireActiveAttemptResponse,
  type QuizWireAttemptResponse,
  type QuizWireAttemptStatus,
  type QuizWireQuestion,
} from './contracts';
import { QuizControlStateStore } from './control-state';
import {
  constantTimeEqualStrings,
  md5Hex,
  quizAnswerKeyHash,
  sha256Hex,
} from './crypto';
import type { RoomStorageBackend, SqlRow } from './sqlite-adapter';

interface SelectedQuestionPlan {
  questionId: string;
  slotId: string;
  position: number;
  variantId: string;
  optionOrder: string[];
}

interface RoomAlarmState {
  nextScoreboardTickMs: number | null;
  nextFlushTickMs: number | null;
  sealed: boolean;
  persistedCloseAtMs: number | null;
  sealMode: QuizRoomSealMode | null;
  eventStatus: 'active' | 'completed' | 'cancelled';
  retentionExpiresAtMs: number | null;
  nextBatchSeq: number;
}

interface AttemptRow extends SqlRow {
  attempt_id: string;
  admission_id: string;
  customer_id: string;
  user_id: string;
  device_hash: string;
  leaderboard_username: string;
  attempt_number: number;
  rules_version: string;
  integrity_tier: string;
  app_version: string;
  platform: string;
  start_request_id: string;
  status: string;
  started_at_ms: number;
  submitted_at_ms: number | null;
  close_reason: string | null;
  score: number;
  current_position: number;
  current_issued_at_ms: number | null;
  questions_json: string;
  exported_batch_id: string | null;
}

interface AnswerRow extends SqlRow {
  attempt_id: string;
  position: number;
  question_id: string;
  slot_id: string;
  variant_id: string;
  option_order_json: string;
  issued_at_ms: number;
  received_at_ms: number;
  raw_answer: string | null;
  selected_answer_hash: string | null;
  answered_in_ms: number;
  timeout: number;
  score_delta: number;
}

interface BatchRow extends SqlRow {
  batch_id: string;
  seq: number;
  created_at_ms: number;
  payload_json: string;
  payload_sha256: string;
  byte_length: number;
  acknowledged: number;
}

export interface StartAttemptInput {
  ticket: QuizAdmissionTicket;
  integrityTier: QuizIntegrityTier;
  acceptedRulesVersion: string;
  termsAccepted: boolean;
  startRequestId: string;
  appVersion: string;
  platform: QuizPlatform;
  nowMs?: number;
}

export interface SubmitAnswerInput {
  ticket: QuizAdmissionTicket;
  attemptId: string;
  questionId: string;
  answer: string;
  receivedAtMs?: number;
  nowMs?: number;
}

export interface RoomScoreboardTickEvent {
  eventId: string;
  merchantId: string;
  roomId: string;
  tickAtMs: number;
  submissions: readonly {
    attemptId: string;
    customerId: string;
    userId: string;
    leaderboardUsername: string;
    score: number;
    elapsedMs: number;
    submittedAtMs: number;
  }[];
}

export interface QuizRoomHooks {
  onPublishBatches?: (
    messages: readonly PackedMessageWithMetrics[]
  ) => Promise<void> | void;
  onScoreboardTick?: (tick: RoomScoreboardTickEvent) => Promise<void> | void;
}

const DEFAULT_RETENTION_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SCOREBOARD_TICK_MS = 2_000;
const DEFAULT_FLUSH_TICK_MS = 1_000;

function quizEffectiveQuestionDeadlineMs(
  issuedAtMs: number,
  eventEndsAtMs: number,
  timePerQuestionSeconds: number
): number {
  const clampedSeconds = Math.max(0, timePerQuestionSeconds);
  return Math.min(eventEndsAtMs, issuedAtMs + clampedSeconds * 1000);
}

function deterministicAttemptId(
  eventId: string,
  customerId: string,
  attemptNumber: number
): string {
  const hex = md5Hex(`${eventId}:${customerId}:${attemptNumber}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function deterministicQuestionId(attemptId: string, position: number): string {
  const hex = md5Hex(`${attemptId}:q:${position}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function selectQuestionsForAttempt(
  event: QuizEventConfig,
  attemptId: string
): SelectedQuestionPlan[] {
  const activeSlots = [...event.slots]
    .filter((slot) => slot.active)
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .slice(0, event.questionCount);

  if (activeSlots.length !== event.questionCount) {
    throw new QuizRoomError('QZ003', 'quiz_question_pool_incomplete', 500);
  }

  const plans: SelectedQuestionPlan[] = [];
  for (let i = 0; i < activeSlots.length; i += 1) {
    const slot = activeSlots[i];
    if (!slot) continue;
    const validVariants = slot.variants
      .filter((v) => v.active && /^[0-9a-f]{64}$/.test(v.answerKeyHash))
      .map((variant) => ({
        variant,
        sortKey: md5Hex(`${variant.id}:${attemptId}`),
      }))
      .sort((a, b) =>
        a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
      );

    const chosen = validVariants[0]?.variant;
    if (!chosen) {
      throw new QuizRoomError('QZ003', 'quiz_question_pool_incomplete', 500);
    }

    const optionOrder = chosen.options
      .map((opt) => ({
        id: opt.id,
        sortKey: md5Hex(`${opt.id}:${attemptId}`),
      }))
      .sort((a, b) =>
        a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
      )
      .map((entry) => entry.id);

    const position = i + 1;
    plans.push({
      questionId: deterministicQuestionId(attemptId, position),
      slotId: slot.id,
      position,
      variantId: chosen.id,
      optionOrder,
    });
  }

  return plans;
}

/**
 * Durable SQLite-backed Quiz Room engine. Runs identically on Cloudflare Durable Object
 * SQLite (`CloudflareSqlStorageAdapter`) and Node `node:sqlite` (`NodeSqliteAdapter`).
 */
export class QuizRoomEngine {
  readonly roomId: string;
  private readonly storage: RoomStorageBackend;
  private readonly controlState: QuizControlStateStore;
  private readonly hooks: QuizRoomHooks;
  private schemaInitialized = false;
  private cachedConfig: QuizEventConfig | null = null;
  private cachedAlarmState: RoomAlarmState | null = null;
  private variantIndex = new Map<string, QuizQuestionVariant>();
  private appCounters = {
    roomRequests: 0,
    bytesPacked: 0,
    queueMessages: 0,
    queueOperations: 0,
  };

  constructor(options: {
    roomId: string;
    storage: RoomStorageBackend;
    controlState?: QuizControlStateStore;
    hooks?: QuizRoomHooks;
  }) {
    this.roomId = options.roomId;
    this.storage = options.storage;
    this.controlState = options.controlState ?? new QuizControlStateStore();
    this.hooks = options.hooks ?? {};
  }

  private ensureSchemaSync(): void {
    if (this.schemaInitialized) return;
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS room_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS room_attempts (
        attempt_id TEXT PRIMARY KEY,
        admission_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        device_hash TEXT NOT NULL,
        leaderboard_username TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        rules_version TEXT NOT NULL,
        integrity_tier TEXT NOT NULL,
        app_version TEXT NOT NULL,
        platform TEXT NOT NULL,
        start_request_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL,
        submitted_at_ms INTEGER,
        close_reason TEXT,
        score INTEGER NOT NULL DEFAULT 0,
        current_position INTEGER NOT NULL,
        current_issued_at_ms INTEGER,
        questions_json TEXT NOT NULL,
        exported_batch_id TEXT
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_room_attempts_customer
        ON room_attempts(customer_id, attempt_number);

      CREATE TABLE IF NOT EXISTS room_answers (
        attempt_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        question_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        variant_id TEXT NOT NULL,
        option_order_json TEXT NOT NULL,
        issued_at_ms INTEGER NOT NULL,
        received_at_ms INTEGER NOT NULL,
        raw_answer TEXT,
        selected_answer_hash TEXT,
        answered_in_ms INTEGER NOT NULL,
        timeout INTEGER NOT NULL,
        score_delta INTEGER NOT NULL,
        PRIMARY KEY (attempt_id, position)
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS room_outbox (
        attempt_id TEXT PRIMARY KEY
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS room_scoreboard_outbox (
        attempt_id TEXT PRIMARY KEY
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS room_batches (
        batch_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID;
    `);
    const seeded = this.storage.exec<{ value_json: string }>(
      `SELECT value_json FROM room_meta WHERE key = 'scoreboard_outbox_seeded_v1'`
    ).rows[0];
    if (!seeded) {
      const alarmMeta = this.storage.exec<{ value_json: string }>(
        `SELECT value_json FROM room_meta WHERE key = 'alarm_state'`
      ).rows[0];
      const parsedAlarm = alarmMeta
        ? (JSON.parse(alarmMeta.value_json) as Partial<RoomAlarmState>)
        : null;
      if (!parsedAlarm?.sealed) {
        this.storage.exec(`
          INSERT OR IGNORE INTO room_scoreboard_outbox (attempt_id)
          SELECT attempt_id FROM room_attempts
          WHERE status = 'submitted' AND submitted_at_ms IS NOT NULL
        `);
      }
      this.storage.exec(
        `INSERT INTO room_meta (key, value_json) VALUES ('scoreboard_outbox_seeded_v1', 'true')
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
      );
    }
    this.schemaInitialized = true;
  }

  private readMetaSync<T>(key: string): T | null {
    this.ensureSchemaSync();
    const res = this.storage.exec<{ value_json: string }>(
      `SELECT value_json FROM room_meta WHERE key = ?`,
      key
    );
    const row = res.rows[0];
    if (!row) return null;
    return JSON.parse(row.value_json) as T;
  }

  private writeMetaSync(key: string, value: unknown): void {
    this.ensureSchemaSync();
    this.storage.exec(
      `INSERT INTO room_meta (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
      key,
      JSON.stringify(value)
    );
  }

  private rebuildVariantIndex(config: QuizEventConfig): void {
    this.variantIndex.clear();
    for (const slot of config.slots) {
      for (const variant of slot.variants) {
        this.variantIndex.set(variant.id, variant);
      }
    }
  }

  private requireConfigSync(): QuizEventConfig {
    if (this.cachedConfig) return this.cachedConfig;
    const loaded = this.readMetaSync<QuizEventConfig>('config');
    if (!loaded) {
      throw new QuizRoomError(
        'QUIZ_ROOM_NOT_INITIALIZED',
        `Room ${this.roomId} has not been initialized`,
        500
      );
    }
    this.cachedConfig = loaded;
    this.rebuildVariantIndex(loaded);
    return loaded;
  }

  private getAlarmStateSync(config?: QuizEventConfig): RoomAlarmState {
    if (this.cachedAlarmState) return this.cachedAlarmState;
    const existing = this.readMetaSync<RoomAlarmState>('alarm_state');
    if (existing) {
      this.cachedAlarmState = existing;
      return existing;
    }
    const fallback: RoomAlarmState = {
      nextScoreboardTickMs: null,
      nextFlushTickMs: null,
      sealed: false,
      persistedCloseAtMs: null,
      sealMode: null,
      eventStatus: config?.status === 'cancelled' ? 'cancelled' : 'active',
      retentionExpiresAtMs: null,
      nextBatchSeq: 1,
    };
    this.cachedAlarmState = fallback;
    return fallback;
  }

  private writeAlarmStateSync(alarmState: RoomAlarmState): void {
    this.writeMetaSync('alarm_state', alarmState);
    this.cachedAlarmState = alarmState;
  }

  private scheduleNextAlarmSync(
    config: QuizEventConfig,
    alarmState: RoomAlarmState
  ): number | null {
    const candidates: number[] = [];
    if (!alarmState.sealed) {
      candidates.push(config.endsAtMs);
      if (alarmState.nextScoreboardTickMs !== null) {
        candidates.push(alarmState.nextScoreboardTickMs);
      }
      if (alarmState.nextFlushTickMs !== null) {
        candidates.push(alarmState.nextFlushTickMs);
      }
    } else if (alarmState.retentionExpiresAtMs !== null) {
      candidates.push(alarmState.retentionExpiresAtMs);
    }

    if (candidates.length === 0) {
      this.storage.deleteAlarm();
      return null;
    }
    const minTs = Math.min(...candidates);
    this.storage.setAlarm(minTs);
    return minTs;
  }

  private enqueueSubmittedAttemptSync(
    attemptId: string,
    config: QuizEventConfig,
    alarmState: RoomAlarmState,
    nowMs: number,
    includeScoreboard = true
  ): RoomAlarmState {
    this.storage.exec(
      `INSERT INTO room_outbox (attempt_id) VALUES (?) ON CONFLICT(attempt_id) DO NOTHING`,
      attemptId
    );
    if (alarmState.sealed || nowMs >= config.endsAtMs) {
      return alarmState;
    }
    if (includeScoreboard) {
      this.storage.exec(
        `INSERT INTO room_scoreboard_outbox (attempt_id) VALUES (?) ON CONFLICT(attempt_id) DO NOTHING`,
        attemptId
      );
    } else {
      this.storage.exec(
        `DELETE FROM room_scoreboard_outbox WHERE attempt_id = ?`,
        attemptId
      );
    }
    const updatedAlarm: RoomAlarmState = {
      ...alarmState,
      nextFlushTickMs:
        alarmState.nextFlushTickMs ??
        nowMs + (config.flushTickMs ?? DEFAULT_FLUSH_TICK_MS),
      nextScoreboardTickMs: includeScoreboard
        ? (alarmState.nextScoreboardTickMs ??
          nowMs + (config.scoreboardTickMs ?? DEFAULT_SCOREBOARD_TICK_MS))
        : alarmState.nextScoreboardTickMs,
    };
    this.writeAlarmStateSync(updatedAlarm);
    this.scheduleNextAlarmSync(config, updatedAlarm);
    return updatedAlarm;
  }

  initialize(config: QuizEventConfig): void {
    this.storage.transactionSync(() => {
      this.ensureSchemaSync();
      this.writeMetaSync('config', config);
      const existingAlarm = this.readMetaSync<RoomAlarmState>('alarm_state');
      if (!existingAlarm) {
        const initial: RoomAlarmState = {
          nextScoreboardTickMs: null,
          nextFlushTickMs: null,
          sealed: false,
          persistedCloseAtMs: null,
          sealMode: null,
          eventStatus: config.status === 'cancelled' ? 'cancelled' : 'active',
          retentionExpiresAtMs: null,
          nextBatchSeq: 1,
        };
        this.writeAlarmStateSync(initial);
        this.scheduleNextAlarmSync(config, initial);
      }
      this.cachedConfig = config;
      this.rebuildVariantIndex(config);
    });
  }

  getBillingCounters(): BillingCounters {
    const sqlTotals = this.storage.getBillingTotals();
    const base = createEmptyBillingCounters();
    return {
      ...base,
      roomRequests: this.appCounters.roomRequests,
      rowsRead: sqlTotals.rowsRead,
      rowsWritten: sqlTotals.rowsWritten,
      bytesPacked: this.appCounters.bytesPacked,
      queueMessages: this.appCounters.queueMessages,
      queueOperations: this.appCounters.queueOperations,
    };
  }

  resetBillingCounters(): void {
    this.storage.resetBillingTotals();
    this.appCounters = {
      roomRequests: 0,
      bytesPacked: 0,
      queueMessages: 0,
      queueOperations: 0,
    };
  }

  getNextAlarmMs(): number | null {
    return this.storage.getAlarm();
  }

  getSealManifest(): QuizRoomSealManifest | null {
    return this.readMetaSync<QuizRoomSealManifest>('seal_manifest');
  }

  getJournalBatch(batchId: string): QuizPackedQueueMessage | null {
    this.ensureSchemaSync();
    const res = this.storage.exec<BatchRow>(
      `SELECT batch_id, seq, created_at_ms, payload_json, payload_sha256, byte_length, acknowledged
       FROM room_batches WHERE batch_id = ?`,
      batchId
    );
    const row = res.rows[0];
    if (!row) return null;
    return JSON.parse(row.payload_json) as QuizPackedQueueMessage;
  }

  listJournalBatchIds(): string[] {
    this.ensureSchemaSync();
    const res = this.storage.exec<{ batch_id: string }>(
      `SELECT batch_id FROM room_batches ORDER BY seq ASC`
    );
    return res.rows.map((r) => r.batch_id);
  }

  acknowledgeBatch(batchId: string): void {
    this.storage.transactionSync(() => {
      this.ensureSchemaSync();
      this.storage.exec(
        `UPDATE room_batches SET acknowledged = 1 WHERE batch_id = ?`,
        batchId
      );
    });
  }

  private buildWireQuestion(
    plan: SelectedQuestionPlan,
    issuedAtMs: number,
    config: QuizEventConfig
  ): QuizWireQuestion {
    const variant = this.variantIndex.get(plan.variantId);
    if (!variant) {
      throw new QuizRoomError(
        'QZ003',
        `Missing variant ${plan.variantId}`,
        500
      );
    }
    const optionMap = new Map<string, QuizQuestionOption>();
    for (const opt of variant.options) {
      optionMap.set(opt.id, { id: opt.id, label: opt.label });
    }
    const orderedOptions: QuizQuestionOption[] = [];
    for (const optId of plan.optionOrder) {
      const opt = optionMap.get(optId);
      if (opt) orderedOptions.push(opt);
    }
    for (const opt of variant.options) {
      if (!plan.optionOrder.includes(opt.id)) {
        orderedOptions.push({ id: opt.id, label: opt.label });
      }
    }
    const deadlineMs = quizEffectiveQuestionDeadlineMs(
      issuedAtMs,
      config.endsAtMs,
      config.timePerQuestionSeconds
    );
    return {
      id: plan.questionId,
      prompt: variant.prompt,
      options: orderedOptions,
      timeLimitSeconds: config.timePerQuestionSeconds,
      index: plan.position,
      total: config.questionCount,
      issuedAt: new Date(issuedAtMs).toISOString(),
      deadlineAt: new Date(deadlineMs).toISOString(),
    };
  }

  private resolveResultsAvailableAt(eventId: string): string | null {
    const published = this.controlState.getPublishedEvent(eventId);
    return published ? new Date(published.publishedAtMs).toISOString() : null;
  }

  private projectAttemptStateSync(
    attemptInput: AttemptRow,
    config: QuizEventConfig,
    alarmState: RoomAlarmState,
    nowMs: number,
    resumedFlag?: boolean
  ): QuizWireAttemptResponse {
    let attempt = attemptInput;
    const eventEndsAt = new Date(config.endsAtMs).toISOString();
    const serverNow = new Date(nowMs).toISOString();
    const resultsAvailableAt = this.resolveResultsAvailableAt(config.eventId);

    if (
      this.controlState.isEventCancelled(config.eventId) ||
      alarmState.eventStatus === 'cancelled' ||
      attempt.status === 'event_cancelled'
    ) {
      if (attempt.status === 'started') {
        const closeAt = attempt.submitted_at_ms ?? nowMs;
        this.storage.exec(
          `UPDATE room_attempts
           SET status = 'event_cancelled', submitted_at_ms = ?, close_reason = 'event_cancelled', current_issued_at_ms = NULL
           WHERE attempt_id = ?`,
          closeAt,
          attempt.attempt_id
        );
        this.storage.exec(
          `INSERT INTO room_outbox (attempt_id) VALUES (?) ON CONFLICT(attempt_id) DO NOTHING`,
          attempt.attempt_id
        );
        attempt = {
          ...attempt,
          status: 'event_cancelled',
          submitted_at_ms: closeAt,
          close_reason: 'event_cancelled',
          current_issued_at_ms: null,
        };
      }
      return {
        attemptId: attempt.attempt_id,
        eventId: config.eventId,
        status: 'event_cancelled',
        serverNow,
        eventEndsAt,
        resultsAvailableAt: null,
        submittedAt: attempt.submitted_at_ms
          ? new Date(attempt.submitted_at_ms).toISOString()
          : null,
        ...(resumedFlag !== undefined ? { resumed: resumedFlag } : {}),
      };
    }

    if (
      nowMs >= config.endsAtMs ||
      alarmState.sealed ||
      attempt.status !== 'started'
    ) {
      if (attempt.status === 'started') {
        // Leave `submitted_at_ms` NULL while unsealed so Coordinator's authoritative
        // `persistedCloseAtMs` (or `endsAtMs` in `scheduled_ends_at` replay) is stamped
        // uniformly on `seal()`. If already sealed, stamp with the sealed close timestamp.
        const closeAt = alarmState.sealed
          ? (attempt.submitted_at_ms ??
            (alarmState.sealMode === 'scheduled_ends_at'
              ? config.endsAtMs
              : alarmState.persistedCloseAtMs))
          : attempt.submitted_at_ms;
        this.storage.exec(
          `UPDATE room_attempts
           SET status = 'submitted', submitted_at_ms = ?, close_reason = 'event_closed', current_issued_at_ms = NULL
           WHERE attempt_id = ?`,
          closeAt,
          attempt.attempt_id
        );
        if (alarmState.sealed) {
          this.storage.exec(
            `INSERT INTO room_outbox (attempt_id) VALUES (?) ON CONFLICT(attempt_id) DO NOTHING`,
            attempt.attempt_id
          );
        }
        attempt = {
          ...attempt,
          status: 'submitted',
          submitted_at_ms: closeAt,
          close_reason: 'event_closed',
          current_issued_at_ms: null,
        };
      }
      const wireStatus: QuizWireAttemptStatus = resultsAvailableAt
        ? 'completed'
        : 'submitted_pending_results';
      return {
        attemptId: attempt.attempt_id,
        eventId: config.eventId,
        status: wireStatus,
        serverNow,
        eventEndsAt,
        resultsAvailableAt,
        submittedAt: attempt.submitted_at_ms
          ? new Date(attempt.submitted_at_ms).toISOString()
          : null,
        ...(resumedFlag !== undefined ? { resumed: resumedFlag } : {}),
      };
    }

    const plans = JSON.parse(attempt.questions_json) as SelectedQuestionPlan[];
    let currentPlan = plans[attempt.current_position - 1];
    let currentIssuedAtMs = attempt.current_issued_at_ms;

    if (currentPlan && currentIssuedAtMs !== null) {
      const deadlineMs = quizEffectiveQuestionDeadlineMs(
        currentIssuedAtMs,
        config.endsAtMs,
        config.timePerQuestionSeconds
      );
      if (nowMs >= deadlineMs) {
        const existingAns = this.storage.exec<{ position: number }>(
          `SELECT position FROM room_answers WHERE attempt_id = ? AND position = ?`,
          attempt.attempt_id,
          currentPlan.position
        );
        if (existingAns.rows.length === 0) {
          const timeoutMs = Math.min(
            config.timePerQuestionSeconds * 1000,
            60_000
          );
          this.storage.exec(
            `INSERT INTO room_answers (
              attempt_id, position, question_id, slot_id, variant_id, option_order_json,
              issued_at_ms, received_at_ms, raw_answer, selected_answer_hash,
              answered_in_ms, timeout, score_delta
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, 0)
            ON CONFLICT(attempt_id, position) DO NOTHING`,
            attempt.attempt_id,
            currentPlan.position,
            currentPlan.questionId,
            currentPlan.slotId,
            currentPlan.variantId,
            JSON.stringify(currentPlan.optionOrder),
            currentIssuedAtMs,
            deadlineMs,
            timeoutMs
          );
        }

        const nextPosition = attempt.current_position + 1;
        if (nextPosition > plans.length || nowMs >= config.endsAtMs) {
          this.storage.exec(
            `UPDATE room_attempts
             SET status = 'submitted', submitted_at_ms = ?, close_reason = 'completed', current_issued_at_ms = NULL
             WHERE attempt_id = ?`,
            nowMs,
            attempt.attempt_id
          );
          this.enqueueSubmittedAttemptSync(
            attempt.attempt_id,
            config,
            alarmState,
            nowMs
          );
          return {
            attemptId: attempt.attempt_id,
            eventId: config.eventId,
            status: 'submitted_pending_results',
            serverNow,
            eventEndsAt,
            resultsAvailableAt,
            submittedAt: new Date(nowMs).toISOString(),
            ...(resumedFlag !== undefined ? { resumed: resumedFlag } : {}),
          };
        }

        currentIssuedAtMs = nowMs;
        this.storage.exec(
          `UPDATE room_attempts
           SET current_position = ?, current_issued_at_ms = ?
           WHERE attempt_id = ?`,
          nextPosition,
          currentIssuedAtMs,
          attempt.attempt_id
        );
        attempt = {
          ...attempt,
          current_position: nextPosition,
          current_issued_at_ms: currentIssuedAtMs,
        };
        currentPlan = plans[nextPosition - 1];
      }
    }

    if (!currentPlan) {
      const submittedAtMs = attempt.submitted_at_ms ?? nowMs;
      this.storage.exec(
        `UPDATE room_attempts
         SET status = 'submitted', submitted_at_ms = ?, close_reason = 'completed', current_issued_at_ms = NULL
         WHERE attempt_id = ?`,
        submittedAtMs,
        attempt.attempt_id
      );
      this.enqueueSubmittedAttemptSync(
        attempt.attempt_id,
        config,
        alarmState,
        nowMs
      );
      return {
        attemptId: attempt.attempt_id,
        eventId: config.eventId,
        status: 'submitted_pending_results',
        serverNow,
        eventEndsAt,
        resultsAvailableAt,
        submittedAt: new Date(submittedAtMs).toISOString(),
        ...(resumedFlag !== undefined ? { resumed: resumedFlag } : {}),
      };
    }

    if (currentIssuedAtMs === null) {
      currentIssuedAtMs = nowMs;
      this.storage.exec(
        `UPDATE room_attempts SET current_issued_at_ms = ? WHERE attempt_id = ?`,
        currentIssuedAtMs,
        attempt.attempt_id
      );
    }

    return {
      attemptId: attempt.attempt_id,
      eventId: config.eventId,
      status: 'in_progress',
      serverNow,
      eventEndsAt,
      resultsAvailableAt,
      ...(resumedFlag !== undefined ? { resumed: resumedFlag } : {}),
      question: this.buildWireQuestion(currentPlan, currentIssuedAtMs, config),
    };
  }

  startAttempt(input: StartAttemptInput): QuizWireAttemptResponse {
    this.appCounters.roomRequests += 1;
    const nowMs = input.nowMs ?? Date.now();
    this.controlState.assertFreshForNewStart(nowMs);

    if (input.ticket.roomId !== this.roomId) {
      throw new QuizRoomError(
        'QUIZ_TICKET_SCOPE_MISMATCH',
        'Ticket room mismatch',
        403
      );
    }

    return this.storage.transactionSync(() => {
      const config = this.requireConfigSync();
      const alarmState = this.getAlarmStateSync(config);

      if (input.ticket.eventId !== config.eventId) {
        throw new QuizRoomError(
          'QUIZ_TICKET_SCOPE_MISMATCH',
          'Ticket event mismatch',
          403
        );
      }
      if (
        config.contractVersion !== 2 ||
        config.status !== 'active' ||
        this.controlState.isEventCancelled(config.eventId) ||
        alarmState.eventStatus === 'cancelled' ||
        alarmState.sealed ||
        nowMs < config.startsAtMs ||
        nowMs >= config.endsAtMs
      ) {
        throw new QuizRoomError('QZ002', 'quiz_event_not_open', 409);
      }
      if (
        !input.termsAccepted ||
        input.acceptedRulesVersion !== config.rulesVersion
      ) {
        throw new QuizRoomError('QZ400', 'quiz_rules_acceptance_required', 400);
      }
      if (
        config.mode === 'test' &&
        this.controlState.isTesterRevoked(config.eventId, input.ticket.userId)
      ) {
        throw new QuizRoomError('QZ403', 'quiz_test_access_required', 403);
      }
      if (
        this.controlState.isAttemptBlocked(
          config.eventId,
          '',
          input.ticket.customerId
        )
      ) {
        throw new QuizRoomError('QZ403', 'quiz_customer_blocked', 403);
      }

      const existingRows = this.storage.exec<AttemptRow>(
        `SELECT * FROM room_attempts WHERE customer_id = ? ORDER BY attempt_number DESC`,
        input.ticket.customerId
      ).rows;

      const activeExisting = existingRows.find((r) => r.status === 'started');
      if (activeExisting) {
        if (
          config.mode === 'live' &&
          activeExisting.device_hash !== input.ticket.deviceHash
        ) {
          throw new QuizRoomError('QZ040', 'quiz_device_binding_required', 403);
        }
        const activeTesterRevoked = this.controlState.isTesterRevoked(
          config.eventId,
          activeExisting.user_id
        );
        const activeRestricted =
          this.controlState.isAttemptDisqualified(activeExisting.attempt_id) ||
          this.controlState.isAttemptBlocked(
            config.eventId,
            activeExisting.attempt_id,
            activeExisting.customer_id
          );
        if (activeTesterRevoked || activeRestricted) {
          const restrictedStatus = activeTesterRevoked
            ? 'tester_revoked'
            : 'disqualified';
          const submittedAtMs = activeExisting.submitted_at_ms ?? nowMs;
          this.storage.exec(
            `UPDATE room_attempts
               SET status = ?, close_reason = ?, submitted_at_ms = ?, current_issued_at_ms = NULL
             WHERE attempt_id = ?`,
            restrictedStatus,
            restrictedStatus,
            submittedAtMs,
            activeExisting.attempt_id
          );
          const nextAlarmState = this.enqueueSubmittedAttemptSync(
            activeExisting.attempt_id,
            config,
            alarmState,
            nowMs,
            false
          );
          return this.projectAttemptStateSync(
            {
              ...activeExisting,
              status: restrictedStatus,
              close_reason: restrictedStatus,
              submitted_at_ms: submittedAtMs,
              current_issued_at_ms: null,
            },
            config,
            nextAlarmState,
            nowMs,
            true
          );
        }
        return this.projectAttemptStateSync(
          activeExisting,
          config,
          alarmState,
          nowMs,
          true
        );
      }

      const requestMatch = existingRows.find(
        (r) => r.start_request_id === input.startRequestId
      );
      if (requestMatch) {
        if (
          config.mode === 'live' &&
          requestMatch.device_hash !== input.ticket.deviceHash
        ) {
          throw new QuizRoomError('QZ040', 'quiz_device_binding_required', 403);
        }
        return this.projectAttemptStateSync(
          requestMatch,
          config,
          alarmState,
          nowMs,
          true
        );
      }

      const nonResetCount = existingRows.filter(
        (r) => r.status !== 'test_reset'
      ).length;
      if (nonResetCount >= config.maxAttempts) {
        throw new QuizRoomError('QZ030', 'attempt_limit_reached', 409);
      }

      const maxNum = existingRows.reduce(
        (max, r) => (r.attempt_number > max ? r.attempt_number : max),
        0
      );
      const attemptNumber = maxNum + 1;
      const attemptId = deterministicAttemptId(
        config.eventId,
        input.ticket.customerId,
        attemptNumber
      );
      const plans = selectQuestionsForAttempt(config, attemptId);
      const admissionId =
        input.ticket.admissionId ??
        `${config.eventId}:${input.ticket.customerId}`;

      this.storage.exec(
        `INSERT INTO room_attempts (
          attempt_id, admission_id, customer_id, user_id, device_hash,
          leaderboard_username, attempt_number, rules_version, integrity_tier,
          app_version, platform, start_request_id, status, started_at_ms,
          submitted_at_ms, close_reason, score, current_position,
          current_issued_at_ms, questions_json, exported_batch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?, NULL, NULL, 0, 1, ?, ?, NULL)`,
        attemptId,
        admissionId,
        input.ticket.customerId,
        input.ticket.userId,
        input.ticket.deviceHash,
        input.ticket.leaderboardUsername.trim(),
        attemptNumber,
        config.rulesVersion,
        input.integrityTier,
        input.appVersion.trim(),
        input.platform,
        input.startRequestId,
        nowMs,
        nowMs,
        JSON.stringify(plans)
      );

      const createdRow: AttemptRow = {
        attempt_id: attemptId,
        admission_id: admissionId,
        customer_id: input.ticket.customerId,
        user_id: input.ticket.userId,
        device_hash: input.ticket.deviceHash,
        leaderboard_username: input.ticket.leaderboardUsername.trim(),
        attempt_number: attemptNumber,
        rules_version: config.rulesVersion,
        integrity_tier: input.integrityTier,
        app_version: input.appVersion.trim(),
        platform: input.platform,
        start_request_id: input.startRequestId,
        status: 'started',
        started_at_ms: nowMs,
        submitted_at_ms: null,
        close_reason: null,
        score: 0,
        current_position: 1,
        current_issued_at_ms: nowMs,
        questions_json: JSON.stringify(plans),
        exported_batch_id: null,
      };

      return this.projectAttemptStateSync(
        createdRow,
        config,
        alarmState,
        nowMs,
        false
      );
    });
  }

  async submitAnswer(
    input: SubmitAnswerInput
  ): Promise<QuizWireAttemptResponse> {
    this.appCounters.roomRequests += 1;
    // Capture ingress timestamp before acquiring transaction lock.
    const receivedAtMs = input.receivedAtMs ?? Date.now();
    const selectedAnswerHash = await quizAnswerKeyHash(input.answer);

    return this.storage.transactionSync(() => {
      const config = this.requireConfigSync();
      const alarmState = this.getAlarmStateSync(config);
      const nowMs = input.nowMs ?? receivedAtMs;

      if (
        input.ticket.eventId !== config.eventId ||
        input.ticket.roomId !== this.roomId
      ) {
        throw new QuizRoomError('QZ004', 'quiz_attempt_not_found', 404);
      }

      const attemptRow = this.storage.exec<AttemptRow>(
        `SELECT * FROM room_attempts WHERE attempt_id = ?`,
        input.attemptId
      ).rows[0];

      if (
        !attemptRow ||
        attemptRow.customer_id !== input.ticket.customerId ||
        attemptRow.user_id !== input.ticket.userId
      ) {
        throw new QuizRoomError('QZ004', 'quiz_attempt_not_found', 404);
      }
      if (
        config.mode === 'live' &&
        attemptRow.device_hash !== input.ticket.deviceHash
      ) {
        throw new QuizRoomError('QZ040', 'quiz_device_binding_required', 403);
      }

      if (
        this.controlState.isEventCancelled(config.eventId) ||
        alarmState.eventStatus === 'cancelled' ||
        receivedAtMs >= config.endsAtMs ||
        alarmState.sealed
      ) {
        return this.projectAttemptStateSync(
          attemptRow,
          config,
          alarmState,
          nowMs
        );
      }

      const canRecoverTimelyFinalAnswer =
        attemptRow.status === 'submitted' &&
        attemptRow.close_reason === 'completed' &&
        attemptRow.exported_batch_id === null;

      if (attemptRow.status !== 'started' && !canRecoverTimelyFinalAnswer) {
        return this.projectAttemptStateSync(
          attemptRow,
          config,
          alarmState,
          nowMs
        );
      }

      const testerRevoked = this.controlState.isTesterRevoked(
        config.eventId,
        attemptRow.user_id
      );
      const attemptRestricted =
        this.controlState.isAttemptDisqualified(attemptRow.attempt_id) ||
        this.controlState.isAttemptBlocked(
          config.eventId,
          attemptRow.attempt_id,
          attemptRow.customer_id
        );
      if (testerRevoked || attemptRestricted) {
        const restrictedStatus = testerRevoked
          ? 'tester_revoked'
          : 'disqualified';
        const submittedAtMs = attemptRow.submitted_at_ms ?? nowMs;
        this.storage.exec(
          `UPDATE room_attempts
             SET status = ?, close_reason = ?, submitted_at_ms = ?, current_issued_at_ms = NULL
           WHERE attempt_id = ?`,
          restrictedStatus,
          restrictedStatus,
          submittedAtMs,
          attemptRow.attempt_id
        );
        const nextAlarmState = this.enqueueSubmittedAttemptSync(
          attemptRow.attempt_id,
          config,
          alarmState,
          nowMs,
          false
        );
        return this.projectAttemptStateSync(
          {
            ...attemptRow,
            status: restrictedStatus,
            close_reason: restrictedStatus,
            submitted_at_ms: submittedAtMs,
            current_issued_at_ms: null,
          },
          config,
          nextAlarmState,
          nowMs
        );
      }

      const plans = JSON.parse(
        attemptRow.questions_json
      ) as SelectedQuestionPlan[];
      const targetPlan = plans.find((p) => p.questionId === input.questionId);
      if (!targetPlan || targetPlan.position > attemptRow.current_position) {
        throw new QuizRoomError('QZ027', 'quiz_question_not_issued', 400);
      }

      // Idempotent duplicate / retry / lost-response recovery: if this question
      // position has already been advanced past `current_position`, check if a
      // concurrent expiry recovery recorded a timeout while this timely answer
      // was hashing; if so, preserve the timely answer without resetting clocks.
      if (
        targetPlan.position < attemptRow.current_position ||
        canRecoverTimelyFinalAnswer
      ) {
        const existingAns = this.storage.exec<{
          timeout: number;
          issued_at_ms: number;
        }>(
          `SELECT timeout, issued_at_ms FROM room_answers
           WHERE attempt_id = ? AND position = ?`,
          attemptRow.attempt_id,
          targetPlan.position
        ).rows[0];
        if (existingAns && existingAns.timeout === 1) {
          const prevDeadlineMs = quizEffectiveQuestionDeadlineMs(
            existingAns.issued_at_ms,
            config.endsAtMs,
            config.timePerQuestionSeconds
          );
          if (receivedAtMs < prevDeadlineMs) {
            const variant = this.variantIndex.get(targetPlan.variantId);
            const matchesKey =
              variant !== undefined &&
              constantTimeEqualStrings(
                selectedAnswerHash,
                variant.answerKeyHash
              );
            const timelyScoreDelta = matchesKey ? 1 : 0;
            const timelyAnsweredInMs = Math.min(
              60_000,
              Math.max(0, Math.floor(receivedAtMs - existingAns.issued_at_ms))
            );
            this.storage.exec(
              `UPDATE room_answers
               SET raw_answer = ?, selected_answer_hash = ?, received_at_ms = ?,
                   answered_in_ms = ?, timeout = 0, score_delta = ?
               WHERE attempt_id = ? AND position = ?`,
              input.answer,
              selectedAnswerHash,
              receivedAtMs,
              timelyAnsweredInMs,
              timelyScoreDelta,
              attemptRow.attempt_id,
              targetPlan.position
            );
            let nextSubmittedAtMs = attemptRow.submitted_at_ms;
            const isRepairedFinalQuestion =
              canRecoverTimelyFinalAnswer &&
              targetPlan.position === plans.length;
            if (isRepairedFinalQuestion) {
              nextSubmittedAtMs = receivedAtMs;
              this.storage.exec(
                `UPDATE room_attempts
                 SET score = score + ?, submitted_at_ms = ?
                 WHERE attempt_id = ?`,
                timelyScoreDelta,
                receivedAtMs,
                attemptRow.attempt_id
              );
            } else if (timelyScoreDelta > 0) {
              this.storage.exec(
                `UPDATE room_attempts SET score = score + ? WHERE attempt_id = ?`,
                timelyScoreDelta,
                attemptRow.attempt_id
              );
            }
            const nextAlarmState =
              isRepairedFinalQuestion ||
              (canRecoverTimelyFinalAnswer && timelyScoreDelta > 0)
                ? this.enqueueSubmittedAttemptSync(
                    attemptRow.attempt_id,
                    config,
                    alarmState,
                    nowMs
                  )
                : alarmState;
            const refreshed = {
              ...attemptRow,
              score: attemptRow.score + timelyScoreDelta,
              submitted_at_ms: nextSubmittedAtMs,
            };
            return this.projectAttemptStateSync(
              refreshed,
              config,
              nextAlarmState,
              nowMs
            );
          }
        }
        return this.projectAttemptStateSync(
          attemptRow,
          config,
          alarmState,
          nowMs
        );
      }

      const issuedAtMs =
        attemptRow.current_issued_at_ms ?? attemptRow.started_at_ms;
      const deadlineMs = quizEffectiveQuestionDeadlineMs(
        issuedAtMs,
        config.endsAtMs,
        config.timePerQuestionSeconds
      );
      const answeredInMs = Math.min(
        60_000,
        Math.max(0, Math.floor(receivedAtMs - issuedAtMs))
      );
      const isLate = receivedAtMs >= deadlineMs;
      const variant = this.variantIndex.get(targetPlan.variantId);
      const matchesKey =
        variant !== undefined &&
        constantTimeEqualStrings(
          selectedAnswerHash,
          variant.answerKeyHash.toLowerCase()
        );
      const scoreDelta = !isLate && matchesKey ? 1 : 0;
      const answeredAtMs = Math.max(receivedAtMs, issuedAtMs);

      this.storage.exec(
        `INSERT INTO room_answers (
          attempt_id, position, question_id, slot_id, variant_id, option_order_json,
          issued_at_ms, received_at_ms, raw_answer, selected_answer_hash,
          answered_in_ms, timeout, score_delta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id, position) DO NOTHING`,
        attemptRow.attempt_id,
        targetPlan.position,
        targetPlan.questionId,
        targetPlan.slotId,
        targetPlan.variantId,
        JSON.stringify(targetPlan.optionOrder),
        issuedAtMs,
        answeredAtMs,
        input.answer,
        selectedAnswerHash,
        answeredInMs,
        isLate ? 1 : 0,
        scoreDelta
      );

      let updatedAttempt: AttemptRow;
      let latestAlarmState = alarmState;
      const isFinalQuestion = targetPlan.position >= plans.length;
      if (isFinalQuestion) {
        this.storage.exec(
          `UPDATE room_attempts
           SET status = 'submitted', submitted_at_ms = ?, close_reason = 'completed',
               score = score + ?, current_issued_at_ms = NULL
           WHERE attempt_id = ?`,
          answeredAtMs,
          scoreDelta,
          attemptRow.attempt_id
        );
        latestAlarmState = this.enqueueSubmittedAttemptSync(
          attemptRow.attempt_id,
          config,
          alarmState,
          nowMs
        );
        updatedAttempt = {
          ...attemptRow,
          status: 'submitted',
          submitted_at_ms: answeredAtMs,
          close_reason: 'completed',
          score: attemptRow.score + scoreDelta,
          current_issued_at_ms: null,
        };
      } else {
        const nextPosition = targetPlan.position + 1;
        const nextIssueNowMs =
          input.nowMs !== undefined
            ? nowMs
            : Math.max(receivedAtMs, Date.now());
        this.storage.exec(
          `UPDATE room_attempts
           SET current_position = ?, current_issued_at_ms = ?, score = score + ?
           WHERE attempt_id = ?`,
          nextPosition,
          nextIssueNowMs,
          scoreDelta,
          attemptRow.attempt_id
        );
        updatedAttempt = {
          ...attemptRow,
          current_position: nextPosition,
          current_issued_at_ms: nextIssueNowMs,
          score: attemptRow.score + scoreDelta,
        };
        return this.projectAttemptStateSync(
          updatedAttempt,
          config,
          latestAlarmState,
          nextIssueNowMs
        );
      }

      return this.projectAttemptStateSync(
        updatedAttempt,
        config,
        latestAlarmState,
        nowMs
      );
    });
  }

  resumeAttempt(
    ticket: QuizAdmissionTicket,
    nowMs = Date.now()
  ): QuizWireActiveAttemptResponse {
    this.appCounters.roomRequests += 1;
    return this.storage.transactionSync(() => {
      const config = this.requireConfigSync();
      const alarmState = this.getAlarmStateSync(config);

      if (ticket.eventId !== config.eventId || ticket.roomId !== this.roomId) {
        throw new QuizRoomError('QZ004', 'quiz_attempt_not_found', 404);
      }

      const attempts = this.storage.exec<AttemptRow>(
        `SELECT * FROM room_attempts WHERE customer_id = ? ORDER BY attempt_number DESC`,
        ticket.customerId
      ).rows;

      const target =
        attempts.find((a) => a.status === 'started') ??
        attempts.find(
          (a) =>
            a.status === 'submitted' ||
            a.status === 'event_cancelled' ||
            a.status === 'disqualified' ||
            a.status === 'tester_revoked'
        );

      const serverNow = new Date(nowMs).toISOString();
      const eventEndsAt = new Date(config.endsAtMs).toISOString();

      if (!target) {
        return {
          availability:
            this.controlState.isEventCancelled(config.eventId) ||
            alarmState.eventStatus === 'cancelled'
              ? 'cancelled'
              : nowMs >= config.endsAtMs
                ? 'unavailable'
                : 'none',
          serverNow,
          eventEndsAt,
        };
      }

      if (config.mode === 'live' && target.device_hash !== ticket.deviceHash) {
        throw new QuizRoomError('QZ040', 'quiz_device_binding_required', 403);
      }

      let effectiveTarget = target;
      let effectiveAlarmState = alarmState;
      if (
        effectiveTarget.status === 'started' &&
        !this.controlState.isEventCancelled(config.eventId) &&
        effectiveAlarmState.eventStatus !== 'cancelled'
      ) {
        const testerRevoked = this.controlState.isTesterRevoked(
          config.eventId,
          effectiveTarget.user_id
        );
        const attemptRestricted =
          this.controlState.isAttemptDisqualified(effectiveTarget.attempt_id) ||
          this.controlState.isAttemptBlocked(
            config.eventId,
            effectiveTarget.attempt_id,
            effectiveTarget.customer_id
          );
        if (testerRevoked || attemptRestricted) {
          const restrictedStatus = testerRevoked
            ? 'tester_revoked'
            : 'disqualified';
          const submittedAtMs = effectiveTarget.submitted_at_ms ?? nowMs;
          this.storage.exec(
            `UPDATE room_attempts
               SET status = ?, close_reason = ?, submitted_at_ms = ?, current_issued_at_ms = NULL
             WHERE attempt_id = ?`,
            restrictedStatus,
            restrictedStatus,
            submittedAtMs,
            effectiveTarget.attempt_id
          );
          effectiveAlarmState = this.enqueueSubmittedAttemptSync(
            effectiveTarget.attempt_id,
            config,
            effectiveAlarmState,
            nowMs,
            false
          );
          effectiveTarget = {
            ...effectiveTarget,
            status: restrictedStatus,
            close_reason: restrictedStatus,
            submitted_at_ms: submittedAtMs,
            current_issued_at_ms: null,
          };
        }
      }

      const projected = this.projectAttemptStateSync(
        effectiveTarget,
        config,
        effectiveAlarmState,
        nowMs,
        true
      );

      if (projected.status === 'in_progress') {
        return {
          availability: 'active',
          serverNow: projected.serverNow,
          eventEndsAt: projected.eventEndsAt,
          attempt: projected,
        };
      }
      if (projected.status === 'event_cancelled') {
        return {
          availability: 'cancelled',
          attemptId: projected.attemptId,
          serverNow: projected.serverNow,
          eventEndsAt: projected.eventEndsAt,
        };
      }
      return {
        availability: 'pending_results',
        attemptId: projected.attemptId,
        serverNow: projected.serverNow,
        eventEndsAt: projected.eventEndsAt,
        submittedAt: projected.submittedAt ?? null,
      };
    });
  }

  private readAttemptAndAnswersSync(attempt: AttemptRow): {
    attempt: AttemptRow;
    answerRows: AnswerRow[];
  } {
    const answerRows = this.storage.exec<AnswerRow>(
      `SELECT * FROM room_answers WHERE attempt_id = ? ORDER BY position ASC`,
      attempt.attempt_id
    ).rows;
    return { attempt, answerRows };
  }

  private async finalizeBundleChecksum(
    attempt: AttemptRow,
    answerRows: readonly AnswerRow[],
    config: QuizEventConfig
  ): Promise<QuizAttemptBundle> {
    const answers: QuizAttemptAnswerTranscript[] = answerRows.map((ans) => ({
      questionId: ans.question_id,
      slotId: ans.slot_id,
      position: ans.position,
      variantId: ans.variant_id,
      optionOrder: JSON.parse(ans.option_order_json) as string[],
      issuedAtMs: ans.issued_at_ms,
      receivedAtMs: ans.received_at_ms,
      rawAnswer: ans.raw_answer,
      selectedAnswerHash: ans.selected_answer_hash,
      answeredInMs: ans.answered_in_ms,
      timeout: ans.timeout === 1,
      scoreDelta: ans.score_delta,
    }));

    const baseBundle: Omit<
      QuizAttemptBundle,
      'partIndex' | 'totalParts' | 'bundleChecksumSha256'
    > = {
      attemptId: attempt.attempt_id,
      admissionId: attempt.admission_id,
      eventId: config.eventId,
      merchantId: config.merchantId,
      roomId: this.roomId,
      userId: attempt.user_id,
      customerId: attempt.customer_id,
      deviceHash: attempt.device_hash,
      leaderboardUsername: attempt.leaderboard_username,
      attemptNumber: attempt.attempt_number,
      rulesVersion: attempt.rules_version,
      integrityTier: attempt.integrity_tier as QuizIntegrityTier,
      appVersion: attempt.app_version,
      platform: attempt.platform as QuizPlatform,
      startRequestId: attempt.start_request_id,
      startedAtMs: attempt.started_at_ms,
      submittedAtMs: attempt.submitted_at_ms ?? attempt.started_at_ms,
      closeReason: (attempt.close_reason ??
        'completed') as QuizAttemptCloseReason,
      score: attempt.score,
      answers,
    };

    const checksum = await computeAttemptBundleChecksumSha256(baseBundle);
    return {
      ...baseBundle,
      partIndex: 0,
      totalParts: 1,
      bundleChecksumSha256: checksum,
    };
  }

  private flushChain: Promise<void> = Promise.resolve();

  async flushPendingBatches(
    nowMs = Date.now()
  ): Promise<PackedMessageWithMetrics[]> {
    const prev = this.flushChain;
    let release!: () => void;
    this.flushChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await this.flushPendingBatchesSerialized(nowMs);
    } finally {
      release();
    }
  }

  private async flushPendingBatchesSerialized(
    nowMs: number
  ): Promise<PackedMessageWithMetrics[]> {
    const pendingRaw = this.storage.transactionSync(() => {
      const config = this.readMetaSync<QuizEventConfig>('config');
      if (!config)
        return {
          config: null,
          items: [] as { attempt: AttemptRow; answerRows: AnswerRow[] }[],
          nextSeq: 1,
        };
      const alarmState = this.getAlarmStateSync(config);
      const outboxRows = this.storage.exec<{ attempt_id: string }>(
        `SELECT attempt_id FROM room_outbox`
      ).rows;
      if (outboxRows.length === 0) {
        return {
          config,
          items: [] as { attempt: AttemptRow; answerRows: AnswerRow[] }[],
          nextSeq: alarmState.nextBatchSeq,
        };
      }
      const items: { attempt: AttemptRow; answerRows: AnswerRow[] }[] = [];
      for (const item of outboxRows) {
        const attempt = this.storage.exec<AttemptRow>(
          `SELECT * FROM room_attempts WHERE attempt_id = ?`,
          item.attempt_id
        ).rows[0];
        if (!attempt || attempt.exported_batch_id !== null) continue;
        items.push(this.readAttemptAndAnswersSync(attempt));
      }
      return { config, items, nextSeq: alarmState.nextBatchSeq };
    });

    if (!pendingRaw.config) {
      return [];
    }

    if (pendingRaw.items.length > 0) {
      const bundles: QuizAttemptBundle[] = [];
      for (const item of pendingRaw.items) {
        bundles.push(
          await this.finalizeBundleChecksum(
            item.attempt,
            item.answerRows,
            pendingRaw.config
          )
        );
      }

      const packer = new QuizBatchPacker({
        eventId: pendingRaw.config.eventId,
        roomId: this.roomId,
        initialSeq: pendingRaw.nextSeq,
      });
      const newlyPacked: PackedMessageWithMetrics[] = [];
      for (const bundle of bundles) {
        newlyPacked.push(...(await packer.addBundle(bundle, nowMs)));
      }
      const tail = await packer.flush(nowMs);
      if (tail) newlyPacked.push(tail);

      const stats = packer.getStats();
      this.appCounters.bytesPacked += stats.bytesPacked;
      this.appCounters.queueMessages += stats.queueMessages;
      this.appCounters.queueOperations += stats.queueOperations;

      // Atomically journal immutable batches, mark attempts exported, clear outbox,
      // and advance nextBatchSeq BEFORE publishing so retries replay the exact same
      // journaled payload while newly completed attempts allocate fresh batch IDs.
      this.storage.transactionSync(() => {
        const config = this.requireConfigSync();
        const alarmState = this.getAlarmStateSync(config);
        for (const packed of newlyPacked) {
          this.storage.exec(
            `INSERT INTO room_batches (
              batch_id, seq, created_at_ms, payload_json, payload_sha256, byte_length, acknowledged
            ) VALUES (?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(batch_id) DO NOTHING`,
            packed.message.batchId,
            packed.message.seq,
            packed.message.createdAtMs,
            packed.serializedJson,
            packed.message.payloadSha256,
            packed.byteLength
          );
          for (const b of packed.message.bundles) {
            this.storage.exec(
              `UPDATE room_attempts SET exported_batch_id = ? WHERE attempt_id = ? AND exported_batch_id IS NULL`,
              packed.message.batchId,
              b.attemptId
            );
            this.storage.exec(
              `DELETE FROM room_outbox WHERE attempt_id = ?`,
              b.attemptId
            );
          }
        }
        const nextAlarm: RoomAlarmState = {
          ...alarmState,
          nextBatchSeq: packer.getNextSeq(),
        };
        this.writeAlarmStateSync(nextAlarm);
      });
    }

    const unackedRows = this.storage.exec<BatchRow>(
      `SELECT batch_id, seq, created_at_ms, payload_json, payload_sha256, byte_length, acknowledged
       FROM room_batches WHERE acknowledged = 0 ORDER BY seq ASC`
    ).rows;

    const toPublish: PackedMessageWithMetrics[] = unackedRows.map((row) => {
      const message = JSON.parse(row.payload_json) as QuizPackedQueueMessage;
      const byteLength = Number(row.byte_length);
      return {
        message,
        serializedJson: row.payload_json,
        byteLength,
        queueOperations: Math.max(1, Math.ceil(byteLength / 65_536)),
      };
    });

    if (toPublish.length === 0) {
      return [];
    }

    // Publish all unacknowledged immutable journal rows; transient failures leave
    // acknowledged = 0 so the next flush replays the exact same payloads verbatim.
    if (this.hooks.onPublishBatches) {
      await this.hooks.onPublishBatches(toPublish);
    }

    this.storage.transactionSync(() => {
      const config = this.requireConfigSync();
      const alarmState = this.getAlarmStateSync(config);
      for (const packed of toPublish) {
        this.storage.exec(
          `UPDATE room_batches SET acknowledged = 1 WHERE batch_id = ?`,
          packed.message.batchId
        );
      }
      const remainingOutbox = Number(
        this.storage.exec<{ c: number }>(
          `SELECT count(*) AS c FROM room_outbox`
        ).rows[0]?.c ?? 0
      );
      const nextAlarm: RoomAlarmState = {
        ...alarmState,
        nextFlushTickMs:
          remainingOutbox > 0
            ? Math.max(
                alarmState.nextFlushTickMs ?? 0,
                Date.now() + (config.flushTickMs ?? DEFAULT_FLUSH_TICK_MS)
              )
            : null,
      };
      this.writeAlarmStateSync(nextAlarm);
      this.scheduleNextAlarmSync(config, nextAlarm);
    });

    return toPublish;
  }

  /**
   * Re-publishes immutable journaled batches from `room_batches` verbatim
   * (preserving original `batchId`, `seq`, and `serializedJson` payload) so
   * operators can recover DLQ'd or dropped queue messages without mutating
   * attempt state or allocating new batch IDs.
   */
  async replayJournaledBatches(
    batchIds?: readonly string[]
  ): Promise<{ replayedCount: number; batchIds: readonly string[] }> {
    const prev = this.flushChain;
    let release!: () => void;
    this.flushChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await this.replayJournaledBatchesSerialized(batchIds);
    } finally {
      release();
    }
  }

  private async replayJournaledBatchesSerialized(
    batchIds?: readonly string[]
  ): Promise<{ replayedCount: number; batchIds: readonly string[] }> {
    if (batchIds !== undefined && batchIds.length === 0) {
      return { replayedCount: 0, batchIds: [] };
    }

    this.ensureSchemaSync();

    let selectedRows: BatchRow[];
    if (batchIds === undefined) {
      selectedRows = this.storage.exec<BatchRow>(
        `SELECT batch_id, seq, created_at_ms, payload_json, payload_sha256, byte_length, acknowledged
         FROM room_batches ORDER BY seq ASC`
      ).rows;
    } else {
      const normalizedIds = Array.from(
        new Set(batchIds.map((id) => id.trim()).filter((id) => id.length > 0))
      );
      if (normalizedIds.length === 0) {
        return { replayedCount: 0, batchIds: [] };
      }
      const placeholders = normalizedIds.map(() => '?').join(', ');
      selectedRows = this.storage.exec<BatchRow>(
        `SELECT batch_id, seq, created_at_ms, payload_json, payload_sha256, byte_length, acknowledged
         FROM room_batches WHERE batch_id IN (${placeholders}) ORDER BY seq ASC`,
        ...normalizedIds
      ).rows;
    }

    if (selectedRows.length === 0) {
      return { replayedCount: 0, batchIds: [] };
    }

    const toReplay: PackedMessageWithMetrics[] = selectedRows.map((row) => {
      const message = JSON.parse(row.payload_json) as QuizPackedQueueMessage;
      const byteLength = Number(row.byte_length);
      return {
        message,
        serializedJson: row.payload_json,
        byteLength,
        queueOperations: Math.max(1, Math.ceil(byteLength / 65_536)),
      };
    });

    if (this.hooks.onPublishBatches) {
      await this.hooks.onPublishBatches(toReplay);
    }

    this.storage.transactionSync(() => {
      for (const packed of toReplay) {
        this.storage.exec(
          `UPDATE room_batches SET acknowledged = 1 WHERE batch_id = ?`,
          packed.message.batchId
        );
      }
    });

    return {
      replayedCount: toReplay.length,
      batchIds: toReplay.map((packed) => packed.message.batchId),
    };
  }

  /**
   * Seals the room at `persistedCloseAtMs` (or `scheduled_ends_at` for fairness replay,
   * or `cancelled`). Handles never-opened rooms, 0-answer started attempts, and partial
   * attempts, flushes all remaining bundles (even 1 underfilled bundle), and persists
   * an immutable `QuizRoomSealManifest`.
   */
  async seal(
    persistedCloseAtMs: number,
    mode: QuizRoomSealMode = 'persisted_close',
    fallbackEvent?: {
      eventId: string;
      endsAtMs: number;
      retentionPeriodMs?: number;
    }
  ): Promise<QuizRoomSealManifest> {
    const existing = this.getSealManifest();
    if (existing) {
      if (
        existing.persistedCloseAtMs === persistedCloseAtMs &&
        existing.sealMode === mode
      ) {
        return existing;
      }
      throw new QuizRoomError(
        'QUIZ_SEAL_CONFLICT',
        `Room ${this.roomId} is already sealed at ${existing.persistedCloseAtMs} (${existing.sealMode})`,
        409
      );
    }

    const prep = this.storage.transactionSync(() => {
      this.ensureSchemaSync();
      let config = this.readMetaSync<QuizEventConfig>('config');
      if (!config) {
        if (!fallbackEvent) {
          throw new QuizRoomError(
            'QUIZ_ROOM_NOT_INITIALIZED',
            `Cannot seal uninitialized room ${this.roomId} without event metadata`,
            400
          );
        }
        config = {
          eventId: fallbackEvent.eventId,
          merchantId: 'unknown',
          mode: 'live',
          contractVersion: 2,
          rulesVersion: 'live-v1',
          questionCount: 1,
          timePerQuestionSeconds: 10,
          maxAttempts: 1,
          startsAtMs: fallbackEvent.endsAtMs - 60_000,
          endsAtMs: fallbackEvent.endsAtMs,
          status: mode === 'cancelled' ? 'cancelled' : 'completed',
          slots: [],
          retentionPeriodMs:
            fallbackEvent.retentionPeriodMs ?? DEFAULT_RETENTION_PERIOD_MS,
        };
        this.writeMetaSync('config', config);
      }

      const alarmState = this.getAlarmStateSync(config);
      const effectiveCloseMs =
        mode === 'scheduled_ends_at' ? config.endsAtMs : persistedCloseAtMs;
      const closeReason: QuizAttemptCloseReason =
        mode === 'cancelled' ? 'event_cancelled' : 'event_closed';
      const targetStatus =
        mode === 'cancelled' ? 'event_cancelled' : 'submitted';

      const openAttempts = this.storage.exec<AttemptRow>(
        `SELECT * FROM room_attempts
         WHERE status = 'started'
            OR (close_reason = 'event_closed' AND submitted_at_ms IS NULL)`
      ).rows;

      for (const open of openAttempts) {
        let openStatus = targetStatus;
        let openCloseReason: QuizAttemptCloseReason = closeReason;
        if (mode !== 'cancelled') {
          if (this.controlState.isTesterRevoked(config.eventId, open.user_id)) {
            openStatus = 'tester_revoked';
            openCloseReason = 'tester_revoked';
          } else if (
            this.controlState.isAttemptDisqualified(open.attempt_id) ||
            this.controlState.isAttemptBlocked(
              config.eventId,
              open.attempt_id,
              open.customer_id
            )
          ) {
            openStatus = 'disqualified';
            openCloseReason = 'disqualified';
          }
        }
        this.storage.exec(
          `UPDATE room_attempts
           SET status = ?, submitted_at_ms = COALESCE(submitted_at_ms, ?),
               close_reason = ?, current_issued_at_ms = NULL
           WHERE attempt_id = ?`,
          openStatus,
          effectiveCloseMs,
          openCloseReason,
          open.attempt_id
        );
        this.storage.exec(
          `INSERT INTO room_outbox (attempt_id) VALUES (?) ON CONFLICT(attempt_id) DO NOTHING`,
          open.attempt_id
        );
      }

      // Also ensure any submitted/cancelled attempt not yet exported is in outbox
      const unexported = this.storage.exec<{ attempt_id: string }>(
        `SELECT attempt_id FROM room_attempts WHERE exported_batch_id IS NULL`
      ).rows;
      for (const row of unexported) {
        this.storage.exec(
          `INSERT INTO room_outbox (attempt_id) VALUES (?) ON CONFLICT(attempt_id) DO NOTHING`,
          row.attempt_id
        );
      }

      const retentionExpiresAtMs =
        persistedCloseAtMs +
        (config.retentionPeriodMs ?? DEFAULT_RETENTION_PERIOD_MS);
      const nextAlarm: RoomAlarmState = {
        ...alarmState,
        nextScoreboardTickMs: null,
        nextFlushTickMs: null,
        sealed: true,
        persistedCloseAtMs,
        sealMode: mode,
        eventStatus: mode === 'cancelled' ? 'cancelled' : 'completed',
        retentionExpiresAtMs,
      };
      this.writeAlarmStateSync(nextAlarm);
      this.scheduleNextAlarmSync(config, nextAlarm);
      return config;
    });

    await this.flushPendingBatches(persistedCloseAtMs);

    const summary = this.storage.transactionSync(() => {
      const attemptRows = this.storage.exec<{
        attempt_id: string;
        status: string;
        started_at_ms: number;
        submitted_at_ms: number | null;
        close_reason: string | null;
        score: number;
      }>(
        `SELECT attempt_id, status, started_at_ms, submitted_at_ms, close_reason, score
         FROM room_attempts ORDER BY attempt_id ASC`
      ).rows;
      const answerCountRow = this.storage.exec<{ c: number }>(
        `SELECT count(*) AS c FROM room_answers`
      ).rows[0];
      const batchRows = this.storage.exec<{ batch_id: string }>(
        `SELECT batch_id FROM room_batches ORDER BY seq ASC`
      ).rows;
      return {
        attemptCount: attemptRows.length,
        answerCount: Number(answerCountRow?.c ?? 0),
        batchIds: batchRows.map((b) => b.batch_id),
        canonicalAttempts: attemptRows.map((r) => ({
          attemptId: r.attempt_id,
          status: r.status,
          startedAtMs: r.started_at_ms,
          submittedAtMs: r.submitted_at_ms,
          closeReason: r.close_reason,
          score: r.score,
        })),
      };
    });

    const eventStatus: 'completed' | 'cancelled' =
      mode === 'cancelled' ? 'cancelled' : 'completed';

    const roomChecksumSha256 = await sha256Hex(
      JSON.stringify({
        eventId: prep.eventId,
        roomId: this.roomId,
        persistedCloseAtMs,
        eventStatus,
        sealMode: mode,
        attemptCount: summary.attemptCount,
        answerCount: summary.answerCount,
        canonicalAttempts: summary.canonicalAttempts,
      })
    );

    const manifest: QuizRoomSealManifest = {
      eventId: prep.eventId,
      roomId: this.roomId,
      persistedCloseAtMs,
      eventStatus,
      sealMode: mode,
      attemptCount: summary.attemptCount,
      answerCount: summary.answerCount,
      batchIds: summary.batchIds,
      batchCount: summary.batchIds.length,
      roomChecksumSha256,
    };

    this.storage.transactionSync(() => {
      this.writeMetaSync('seal_manifest', manifest);
    });
    return manifest;
  }

  /**
   * Exports all terminalized attempt bundles currently stored in this room
   * (completed attempts during solo warmup, or all sealed attempts after close).
   */
  async exportCompletedBundles(): Promise<QuizAttemptBundle[]> {
    const raw = this.storage.transactionSync(() => {
      this.ensureSchemaSync();
      const config = this.readMetaSync<QuizEventConfig>('config');
      if (!config) return { config: null, items: [] };
      const rows = this.storage.exec<AttemptRow>(
        `SELECT * FROM room_attempts
         WHERE status IN ('submitted', 'scored', 'event_cancelled')
           AND submitted_at_ms IS NOT NULL
         ORDER BY attempt_id ASC`
      ).rows;
      const items = rows.map((attempt) =>
        this.readAttemptAndAnswersSync(attempt)
      );
      return { config, items };
    });

    if (!raw.config || raw.items.length === 0) {
      return [];
    }

    const bundles: QuizAttemptBundle[] = [];
    for (const item of raw.items) {
      bundles.push(
        await this.finalizeBundleChecksum(
          item.attempt,
          item.answerRows,
          raw.config
        )
      );
    }
    return bundles;
  }

  /**
   * Single chained alarm handler (`MIN(next_scoreboard_tick, next_flush_tick, ends_at)`).
   * At `nowMs >= config.endsAtMs`, stops answer intake and flushes completed bundles
   * without sealing — ONLY the Coordinator supplies `persistedCloseAtMs` to `seal()`.
   */
  async onAlarm(nowMs = Date.now()): Promise<{
    flushedBatches: number;
    scoreboardTicked: boolean;
    sealed: boolean;
    intakeStopped: boolean;
    deletedAll: boolean;
  }> {
    const config = this.readMetaSync<QuizEventConfig>('config');
    if (!config) {
      return {
        flushedBatches: 0,
        scoreboardTicked: false,
        sealed: false,
        intakeStopped: false,
        deletedAll: false,
      };
    }

    const alarmState = this.getAlarmStateSync(config);
    let flushedBatches = 0;
    let scoreboardTicked = false;
    const sealed = false;
    let intakeStopped = false;
    let deletedAll = false;

    if (alarmState.sealed) {
      if (
        alarmState.retentionExpiresAtMs !== null &&
        nowMs >= alarmState.retentionExpiresAtMs
      ) {
        this.deleteAllIfRetentionExpired(nowMs);
        deletedAll = true;
      }
      return {
        flushedBatches,
        scoreboardTicked,
        sealed,
        intakeStopped,
        deletedAll,
      };
    }

    const shouldFlushOnEnd = nowMs >= config.endsAtMs;
    if (
      shouldFlushOnEnd ||
      (alarmState.nextFlushTickMs !== null &&
        nowMs >= alarmState.nextFlushTickMs)
    ) {
      const batches = await this.flushPendingBatches(nowMs);
      flushedBatches = batches.length;
    }

    if (
      alarmState.nextScoreboardTickMs !== null &&
      nowMs >= alarmState.nextScoreboardTickMs
    ) {
      const pending = this.storage.exec<AttemptRow>(
        `SELECT a.*
         FROM room_scoreboard_outbox o
         INNER JOIN room_attempts a ON a.attempt_id = o.attempt_id
         WHERE a.status = 'submitted' AND a.submitted_at_ms IS NOT NULL
         ORDER BY o.attempt_id ASC`
      ).rows;
      if (pending.length > 0) {
        scoreboardTicked = true;
        if (this.hooks.onScoreboardTick) {
          await this.hooks.onScoreboardTick({
            eventId: config.eventId,
            merchantId: config.merchantId,
            roomId: this.roomId,
            tickAtMs: nowMs,
            submissions: pending.map((a) => ({
              attemptId: a.attempt_id,
              customerId: a.customer_id,
              userId: a.user_id,
              leaderboardUsername: a.leaderboard_username,
              score: a.score,
              elapsedMs: Math.max(
                0,
                (a.submitted_at_ms ?? nowMs) - a.started_at_ms
              ),
              submittedAtMs: a.submitted_at_ms ?? nowMs,
            })),
          });
        }
      }
      const deliveredIds = pending.map((a) => a.attempt_id);
      this.storage.transactionSync(() => {
        for (const attemptId of deliveredIds) {
          this.storage.exec(
            `DELETE FROM room_scoreboard_outbox WHERE attempt_id = ?`,
            attemptId
          );
        }
        this.storage.exec(
          `DELETE FROM room_scoreboard_outbox
           WHERE NOT EXISTS (
             SELECT 1 FROM room_attempts AS a
             WHERE a.attempt_id = room_scoreboard_outbox.attempt_id
               AND a.status = 'submitted'
               AND a.submitted_at_ms IS NOT NULL
           )`
        );
        const remainingRow = this.storage.exec<{ c: number }>(
          `SELECT count(*) AS c FROM room_scoreboard_outbox`
        ).rows[0];
        const remaining = Number(remainingRow?.c ?? 0);
        const latest = this.getAlarmStateSync(config);
        if (!latest.sealed) {
          const updated: RoomAlarmState = {
            ...latest,
            nextScoreboardTickMs:
              remaining > 0 && nowMs < config.endsAtMs
                ? nowMs +
                  (config.scoreboardTickMs ?? DEFAULT_SCOREBOARD_TICK_MS)
                : null,
          };
          this.writeAlarmStateSync(updated);
          this.scheduleNextAlarmSync(config, updated);
        }
      });
    }

    if (nowMs >= config.endsAtMs && !this.getAlarmStateSync(config).sealed) {
      intakeStopped = true;
      this.storage.transactionSync(() => {
        const latest = this.getAlarmStateSync(config);
        if (!latest.sealed) {
          const updated: RoomAlarmState = {
            ...latest,
            nextScoreboardTickMs: null,
            nextFlushTickMs: null,
          };
          this.writeAlarmStateSync(updated);
          this.storage.deleteAlarm();
        }
      });
    }

    return {
      flushedBatches,
      scoreboardTicked,
      sealed,
      intakeStopped,
      deletedAll,
    };
  }

  /**
   * Guarded `deleteAll()` — refuses to drop durable room storage or journal batches
   * until the room is sealed and private-result retention has expired.
   */
  deleteAllIfRetentionExpired(nowMs = Date.now()): void {
    const config = this.readMetaSync<QuizEventConfig>('config');
    if (!config) return;
    const alarmState = this.getAlarmStateSync(config);
    const sealManifest = this.getSealManifest();
    const unackedBatches = Number(
      this.storage.exec<{ c: number }>(
        `SELECT count(*) AS c FROM room_batches WHERE acknowledged = 0`
      ).rows[0]?.c ?? 0
    );
    if (
      !alarmState.sealed ||
      !sealManifest ||
      unackedBatches > 0 ||
      alarmState.retentionExpiresAtMs === null
    ) {
      throw new QuizRoomError(
        'QUIZ_ROOM_NOT_SEALED',
        `Cannot deleteAll() on unsealed or unacknowledged room ${this.roomId}`,
        409
      );
    }
    if (nowMs < alarmState.retentionExpiresAtMs) {
      throw new QuizRoomError(
        'QUIZ_RETENTION_NOT_EXPIRED',
        `Cannot deleteAll() on room ${this.roomId} before retention expires at ${alarmState.retentionExpiresAtMs}`,
        409
      );
    }
    this.storage.deleteAll();
    this.schemaInitialized = false;
    this.cachedConfig = null;
    this.cachedAlarmState = null;
    this.variantIndex.clear();
  }
}
