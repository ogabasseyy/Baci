import {
  type BillingCounters,
  createEmptyBillingCounters,
  type QuizControlStateSnapshot,
  QuizRoomError,
  type QuizRoomSealManifest,
  type QuizRoomSealMode,
} from './contracts';
import { createEmptyControlState } from './control-state';
import { sha256Hex } from './crypto';
import type { RoomStorageBackend, SqlRow } from './sqlite-adapter';

export interface CoordinatorRoomClient {
  sealRoom(params: {
    eventId: string;
    roomId: string;
    persistedCloseAtMs: number;
    mode: QuizRoomSealMode;
    endsAtMs: number;
  }): Promise<QuizRoomSealManifest>;
}

export interface CoordinatorStateSnapshot {
  eventId: string;
  endsAtMs: number;
  persistedCloseAtMs: number | null;
  sealMode: QuizRoomSealMode | null;
  expectedRoomIds: readonly string[];
  sealedCount: number;
  allRoomsSealed: boolean;
  totalAttempts: number;
  totalAnswers: number;
  totalBatches: number;
  manifestChecksumSha256: string | null;
  pendingRoomIds: readonly string[];
  failedRooms: Readonly<Record<string, string>>;
}

interface CoordMetaRow extends SqlRow {
  event_id: string;
  ends_at_ms: number;
  persisted_close_at_ms: number | null;
  seal_mode: string | null;
  expected_rooms_json: string;
  manifest_checksum_sha256: string | null;
}

interface CoordRoomSealRow extends SqlRow {
  event_id: string;
  room_id: string;
  status: string;
  manifest_json: string | null;
  last_error: string | null;
  attempts: number;
}

/**
 * Retryable, SQLite-backed post-close coordinator sweeping EVERY expected room
 * (including never-opened rooms) with one persisted close timestamp and enforcing
 * the two-fact publication gate (`allRoomsSealed && scoringRunCompleted`).
 */
export class EventCoordinatorEngine {
  private readonly storage: RoomStorageBackend;
  private readonly roomClient: CoordinatorRoomClient;
  private schemaInitialized = false;

  constructor(options: {
    storage: RoomStorageBackend;
    roomClient: CoordinatorRoomClient;
  }) {
    this.storage = options.storage;
    this.roomClient = options.roomClient;
  }

  private ensureSchemaSync(): void {
    if (this.schemaInitialized) return;
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS coordinator_events (
        event_id TEXT PRIMARY KEY,
        ends_at_ms INTEGER NOT NULL,
        persisted_close_at_ms INTEGER,
        seal_mode TEXT,
        expected_rooms_json TEXT NOT NULL,
        manifest_checksum_sha256 TEXT
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS coordinator_room_seals (
        event_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        status TEXT NOT NULL,
        manifest_json TEXT,
        last_error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (event_id, room_id)
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS coordinator_control_state (
        event_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL
      ) WITHOUT ROWID;
    `);
    this.schemaInitialized = true;
  }

  getControlState(eventId: string): QuizControlStateSnapshot | null {
    this.ensureSchemaSync();
    const row = this.storage.exec<{ snapshot_json: string }>(
      `SELECT snapshot_json FROM coordinator_control_state WHERE event_id = ?`,
      eventId
    ).rows[0];
    return row
      ? (JSON.parse(row.snapshot_json) as QuizControlStateSnapshot)
      : null;
  }

  setControlState(
    eventId: string,
    next: QuizControlStateSnapshot
  ): { applied: boolean; snapshot: QuizControlStateSnapshot } {
    return this.storage.transactionSync(() => {
      const current = this.getControlState(eventId);
      if (current) {
        if (next.version < current.version) {
          return { applied: false, snapshot: current };
        }
        if (
          next.version === current.version &&
          next.updatedAtMs <= current.updatedAtMs
        ) {
          return { applied: false, snapshot: current };
        }
      }
      this.storage.exec(
        `INSERT INTO coordinator_control_state (event_id, snapshot_json)
         VALUES (?, ?)
         ON CONFLICT(event_id) DO UPDATE SET snapshot_json = excluded.snapshot_json`,
        eventId,
        JSON.stringify(next)
      );
      return { applied: true, snapshot: next };
    });
  }

  refreshControlStateFreshness(
    eventId: string,
    updatedAtMs: number
  ): QuizControlStateSnapshot {
    return this.storage.transactionSync(() => {
      const current = this.getControlState(eventId);
      const next: QuizControlStateSnapshot = current
        ? {
            ...current,
            updatedAtMs: Math.max(current.updatedAtMs, updatedAtMs),
          }
        : createEmptyControlState(updatedAtMs, 1);
      this.storage.exec(
        `INSERT INTO coordinator_control_state (event_id, snapshot_json)
         VALUES (?, ?)
         ON CONFLICT(event_id) DO UPDATE SET snapshot_json = excluded.snapshot_json`,
        eventId,
        JSON.stringify(next)
      );
      return next;
    });
  }

  getBillingCounters(): BillingCounters {
    const sql = this.storage.getBillingTotals();
    return {
      ...createEmptyBillingCounters(),
      rowsRead: sql.rowsRead,
      rowsWritten: sql.rowsWritten,
    };
  }

  freezeExpectedRooms(params: {
    eventId: string;
    endsAtMs: number;
    expectedRoomIds: readonly string[];
  }): void {
    this.storage.transactionSync(() => {
      this.ensureSchemaSync();
      const uniqueRooms = Array.from(new Set(params.expectedRoomIds)).sort();
      const existing = this.storage.exec<CoordMetaRow>(
        `SELECT * FROM coordinator_events WHERE event_id = ?`,
        params.eventId
      ).rows[0];
      if (existing) return;

      this.storage.exec(
        `INSERT INTO coordinator_events (
          event_id, ends_at_ms, persisted_close_at_ms, seal_mode,
          expected_rooms_json, manifest_checksum_sha256
        ) VALUES (?, ?, NULL, NULL, ?, NULL)`,
        params.eventId,
        params.endsAtMs,
        JSON.stringify(uniqueRooms)
      );

      for (const roomId of uniqueRooms) {
        this.storage.exec(
          `INSERT INTO coordinator_room_seals (
            event_id, room_id, status, manifest_json, last_error, attempts
          ) VALUES (?, ?, 'pending', NULL, NULL, 0)
          ON CONFLICT(event_id, room_id) DO NOTHING`,
          params.eventId,
          roomId
        );
      }
    });
  }

  /**
   * Sweeps every unsealed expected room using the persisted close timestamp
   * (captured once on first close/cancel). Safe to call repeatedly across restarts.
   */
  async sweepClose(params: {
    eventId: string;
    nowMs?: number;
    mode?: QuizRoomSealMode;
    maxRoomsPerSweep?: number;
  }): Promise<CoordinatorStateSnapshot> {
    const prep = this.storage.transactionSync(() => {
      this.ensureSchemaSync();
      const meta = this.storage.exec<CoordMetaRow>(
        `SELECT * FROM coordinator_events WHERE event_id = ?`,
        params.eventId
      ).rows[0];
      if (!meta) {
        throw new QuizRoomError(
          'QUIZ_EVENT_NOT_FROZEN',
          `Coordinator has no frozen rooms for event ${params.eventId}`,
          404
        );
      }

      const mode: QuizRoomSealMode =
        (params.mode ?? (meta.seal_mode as QuizRoomSealMode | null)) ||
        'persisted_close';
      const nowMs = params.nowMs ?? Date.now();
      if (
        meta.persisted_close_at_ms === null &&
        mode !== 'cancelled' &&
        nowMs < meta.ends_at_ms
      ) {
        throw new QuizRoomError(
          'QUIZ_EVENT_STILL_ACTIVE',
          `Cannot close active event ${params.eventId} before endsAtMs`,
          409
        );
      }
      const persistedCloseAtMs = meta.persisted_close_at_ms ?? nowMs;

      if (meta.persisted_close_at_ms === null || meta.seal_mode === null) {
        this.storage.exec(
          `UPDATE coordinator_events
           SET persisted_close_at_ms = ?, seal_mode = ?
           WHERE event_id = ?`,
          persistedCloseAtMs,
          mode,
          params.eventId
        );
      }

      const pendingRows = this.storage.exec<CoordRoomSealRow>(
        `SELECT * FROM coordinator_room_seals
         WHERE event_id = ? AND status <> 'sealed'
         ORDER BY attempts ASC, room_id ASC`,
        params.eventId
      ).rows;

      const limit = params.maxRoomsPerSweep ?? pendingRows.length;
      return {
        endsAtMs: meta.ends_at_ms,
        persistedCloseAtMs,
        sealMode: (meta.seal_mode as QuizRoomSealMode | null) ?? mode,
        pendingRoomIds: pendingRows.slice(0, limit).map((r) => r.room_id),
      };
    });

    for (const roomId of prep.pendingRoomIds) {
      try {
        const manifest = await this.roomClient.sealRoom({
          eventId: params.eventId,
          roomId,
          persistedCloseAtMs: prep.persistedCloseAtMs,
          mode: prep.sealMode,
          endsAtMs: prep.endsAtMs,
        });
        this.storage.transactionSync(() => {
          this.storage.exec(
            `UPDATE coordinator_room_seals
             SET status = 'sealed', manifest_json = ?, last_error = NULL, attempts = attempts + 1
             WHERE event_id = ? AND room_id = ?`,
            JSON.stringify(manifest),
            params.eventId,
            roomId
          );
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown seal error';
        this.storage.transactionSync(() => {
          this.storage.exec(
            `UPDATE coordinator_room_seals
             SET status = 'retry', last_error = ?, attempts = attempts + 1
             WHERE event_id = ? AND room_id = ? AND status <> 'sealed'`,
            message,
            params.eventId,
            roomId
          );
        });
      }
    }

    return this.getSnapshot(params.eventId);
  }

  async getSnapshot(eventId: string): Promise<CoordinatorStateSnapshot> {
    this.ensureSchemaSync();
    const meta = this.storage.exec<CoordMetaRow>(
      `SELECT * FROM coordinator_events WHERE event_id = ?`,
      eventId
    ).rows[0];
    if (!meta) {
      throw new QuizRoomError(
        'QUIZ_EVENT_NOT_FROZEN',
        `Coordinator has no frozen rooms for event ${eventId}`,
        404
      );
    }

    const expectedRoomIds = JSON.parse(meta.expected_rooms_json) as string[];
    const rows = this.storage.exec<CoordRoomSealRow>(
      `SELECT * FROM coordinator_room_seals WHERE event_id = ? ORDER BY room_id ASC`,
      eventId
    ).rows;

    let sealedCount = 0;
    let totalAttempts = 0;
    let totalAnswers = 0;
    let totalBatches = 0;
    const pendingRoomIds: string[] = [];
    const failedRooms: Record<string, string> = {};
    const manifests: QuizRoomSealManifest[] = [];

    for (const row of rows) {
      if (row.status === 'sealed' && row.manifest_json) {
        sealedCount += 1;
        const m = JSON.parse(row.manifest_json) as QuizRoomSealManifest;
        manifests.push(m);
        totalAttempts += m.attemptCount;
        totalAnswers += m.answerCount;
        totalBatches += m.batchCount;
      } else {
        pendingRoomIds.push(row.room_id);
        if (row.last_error) {
          failedRooms[row.room_id] = row.last_error;
        }
      }
    }

    const allRoomsSealed =
      expectedRoomIds.length === rows.length &&
      sealedCount === expectedRoomIds.length;

    let manifestChecksumSha256 = meta.manifest_checksum_sha256;
    if (allRoomsSealed && !manifestChecksumSha256) {
      manifestChecksumSha256 = await sha256Hex(
        JSON.stringify({
          eventId,
          persistedCloseAtMs: meta.persisted_close_at_ms,
          sealMode: meta.seal_mode,
          roomChecksums: manifests.map((m) => ({
            roomId: m.roomId,
            roomChecksumSha256: m.roomChecksumSha256,
          })),
        })
      );
      this.storage.exec(
        `UPDATE coordinator_events SET manifest_checksum_sha256 = ? WHERE event_id = ?`,
        manifestChecksumSha256,
        eventId
      );
    }

    return {
      eventId,
      endsAtMs: meta.ends_at_ms,
      persistedCloseAtMs: meta.persisted_close_at_ms,
      sealMode: (meta.seal_mode as QuizRoomSealMode | null) ?? null,
      expectedRoomIds,
      sealedCount,
      allRoomsSealed,
      totalAttempts,
      totalAnswers,
      totalBatches,
      manifestChecksumSha256,
      pendingRoomIds,
      failedRooms,
    };
  }

  /**
   * Two-fact publication gate: publication and awards are strictly blocked until
   * BOTH all expected rooms have sealed AND the DB scoring run has completed for
   * that sealed manifest checksum.
   */
  async canPublishResults(params: {
    eventId: string;
    completedScoringManifestChecksum: string | null;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const snap = await this.getSnapshot(params.eventId);
    if (!snap.allRoomsSealed || !snap.manifestChecksumSha256) {
      return {
        allowed: false,
        reason: `Unsealed rooms remaining: ${snap.pendingRoomIds.length}`,
      };
    }
    if (
      !params.completedScoringManifestChecksum ||
      params.completedScoringManifestChecksum !== snap.manifestChecksumSha256
    ) {
      return {
        allowed: false,
        reason: 'Scoring run not completed for sealed manifest',
      };
    }
    return { allowed: true };
  }
}
