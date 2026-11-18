import { QuizRoomError } from './contracts';
import type { CarrierReportRow, DemoReportPayload } from './demo-ui';
import type { RoomStorageBackend, SqlRow } from './sqlite-adapter';

export interface DemoRoundState {
  round: 1 | 2 | 3;
  eventId: string;
  merchantId: string;
  roomIds: readonly string[];
  startsAtMs: number;
  endsAtMs: number;
  nextAssignSeq: number;
  soloInstantResult?: boolean;
  reconciledAtMs?: number | null;
}

export interface DemoTelemetryInput {
  eventId?: string;
  round?: number;
  carrier: string;
  nickname?: string;
  attemptId?: string;
  questionIndex?: number;
  tapToAckMs: number;
  serverCommitMs?: number;
  retries?: number;
  timedOut?: boolean;
  colo: string;
}

interface TelemetryRow extends SqlRow {
  carrier: string;
  tap_to_ack_ms: number;
  retries: number;
  timed_out: number;
  colo: string;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1)
  );
  return sorted[idx] ?? 0;
}

export class DemoStateEngine {
  private readonly storage: RoomStorageBackend;
  private schemaReady = false;

  constructor(storage: RoomStorageBackend) {
    this.storage = storage;
  }

  private ensureSchemaSync(): void {
    if (this.schemaReady) return;
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS demo_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS demo_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        round_num INTEGER NOT NULL,
        carrier TEXT NOT NULL,
        nickname TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        question_index INTEGER NOT NULL,
        tap_to_ack_ms REAL NOT NULL,
        server_commit_ms REAL NOT NULL,
        retries INTEGER NOT NULL,
        timed_out INTEGER NOT NULL,
        colo TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
    `);
    this.schemaReady = true;
  }

  setActiveRound(state: DemoRoundState): void {
    this.storage.transactionSync(() => {
      this.ensureSchemaSync();
      this.storage.exec(
        `INSERT INTO demo_meta (key, value_json) VALUES ('active_round', ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
        JSON.stringify(state)
      );
    });
  }

  getActiveRound(): DemoRoundState | null {
    this.ensureSchemaSync();
    const row = this.storage.exec<{ value_json: string }>(
      `SELECT value_json FROM demo_meta WHERE key = 'active_round'`
    ).rows[0];
    return row ? (JSON.parse(row.value_json) as DemoRoundState) : null;
  }

  allocateCheckIn(requestedRoomId?: string): {
    round: DemoRoundState;
    roomId: string;
    playerSeq: number;
  } {
    return this.storage.transactionSync(() => {
      const round = this.getActiveRound();
      if (!round || round.roomIds.length === 0) {
        throw new QuizRoomError(
          'QUIZ_DEMO_ROUND_NOT_READY',
          'No active demo round is configured yet',
          409
        );
      }
      const seq = round.nextAssignSeq;
      const prefixedRequest = requestedRoomId
        ? `${round.eventId}:${requestedRoomId}`
        : undefined;
      const roomId =
        requestedRoomId && round.roomIds.includes(requestedRoomId)
          ? requestedRoomId
          : prefixedRequest && round.roomIds.includes(prefixedRequest)
            ? prefixedRequest
            : (round.roomIds[seq % round.roomIds.length] ??
              `${round.eventId}:room-0000`);
      this.storage.exec(
        `INSERT INTO demo_meta (key, value_json) VALUES ('active_round', ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
        JSON.stringify({ ...round, nextAssignSeq: seq + 1 })
      );
      return { round, roomId, playerSeq: seq };
    });
  }

  markRoundReconciled(publishedAtMs: number): void {
    this.storage.transactionSync(() => {
      const round = this.getActiveRound();
      if (!round) return;
      this.storage.exec(
        `INSERT INTO demo_meta (key, value_json) VALUES ('active_round', ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
        JSON.stringify({ ...round, reconciledAtMs: publishedAtMs })
      );
    });
  }

  recordTelemetry(input: DemoTelemetryInput, nowMs = Date.now()): void {
    this.storage.transactionSync(() => {
      this.ensureSchemaSync();
      this.storage.exec(
        `INSERT INTO demo_telemetry (
          event_id, round_num, carrier, nickname, attempt_id, question_index,
          tap_to_ack_ms, server_commit_ms, retries, timed_out, colo, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.eventId ?? 'demo',
        input.round ?? 1,
        input.carrier.trim() || 'Unknown',
        (input.nickname ?? 'Player').trim(),
        input.attemptId ?? '',
        input.questionIndex ?? 0,
        Math.max(0, Number(input.tapToAckMs) || 0),
        Math.max(0, Number(input.serverCommitMs) || 0),
        Math.max(0, Math.floor(Number(input.retries) || 0)),
        input.timedOut ? 1 : 0,
        input.colo || 'LOCAL',
        nowMs
      );
    });
  }

  buildReport(nowMs = Date.now()): DemoReportPayload {
    this.ensureSchemaSync();
    const rows = this.storage.exec<TelemetryRow>(
      `SELECT carrier, tap_to_ack_ms, retries, timed_out, colo FROM demo_telemetry`
    ).rows;
    const byCarrier = new Map<
      string,
      {
        latencies: number[];
        retries: number;
        timeouts: number;
        colos: Set<string>;
      }
    >();
    for (const r of rows) {
      let bucket = byCarrier.get(r.carrier);
      if (!bucket) {
        bucket = { latencies: [], retries: 0, timeouts: 0, colos: new Set() };
        byCarrier.set(r.carrier, bucket);
      }
      bucket.latencies.push(r.tap_to_ack_ms);
      bucket.retries += r.retries;
      bucket.timeouts += r.timed_out;
      bucket.colos.add(r.colo);
    }

    const carriers: CarrierReportRow[] = [];
    for (const [carrier, bucket] of byCarrier.entries()) {
      const sorted = [...bucket.latencies].sort((a, b) => a - b);
      const under1s = sorted.filter((ms) => ms <= 1000).length;
      carriers.push({
        carrier,
        count: sorted.length,
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        p99Ms: percentile(sorted, 0.99),
        under1sRatePct: sorted.length > 0 ? (under1s / sorted.length) * 100 : 0,
        retries: bucket.retries,
        timeouts: bucket.timeouts,
        colos: Array.from(bucket.colos).sort(),
      });
    }
    carriers.sort((a, b) => a.carrier.localeCompare(b.carrier));
    return {
      generatedAtIso: new Date(nowMs).toISOString(),
      totalSamples: rows.length,
      carriers,
    };
  }
}
