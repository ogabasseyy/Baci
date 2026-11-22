import {
  type BillingCounters,
  createEmptyBillingCounters,
  type QuizLeaderboardApiEntry,
  type QuizLeaderboardApiResponse,
  type QuizLiveRankSubmission,
  QuizRoomError,
} from './contracts';
import { QuizControlStateStore } from './control-state';
import type { RoomStorageBackend, SqlRow } from './sqlite-adapter';

export interface LiveRankOrderingKey {
  score: number;
  elapsedMs: number;
  submittedAtMs: number;
  attemptId: string;
}

export interface LiveRankEntry extends LiveRankOrderingKey {
  customerId: string;
  userId: string;
  merchantId: string;
  leaderboardUsername: string;
  attemptStatus: 'submitted' | 'scored';
}

export interface LiveRankRangeMeta {
  rangeId: string;
  minKey: LiveRankOrderingKey;
  maxKey: LiveRankOrderingKey;
  count: number;
  prefixBeforeCount: number;
  version: number;
}

export interface LiveRankManifest {
  eventId: string;
  merchantId: string;
  version: number;
  totalCount: number;
  updatedAtMs: number;
  ranges: LiveRankRangeMeta[];
}

export interface LiveRankPublishResult {
  version: number;
  published: boolean;
  dirtyRangesWritten: number;
  totalRanges: number;
  totalEntries: number;
  rowsWrittenThisTick: number;
  bytesWrittenThisTick: number;
}

interface SubmissionRow extends SqlRow {
  event_id: string;
  customer_id: string;
  user_id: string;
  merchant_id: string;
  attempt_id: string;
  leaderboard_username: string;
  score: number;
  elapsed_ms: number;
  submitted_at_ms: number;
  attempt_status: string;
}

interface RangeRow extends SqlRow {
  range_id: string;
  entries_json: string;
  version: number;
}

interface ManifestRow extends SqlRow {
  event_id: string;
  manifest_json: string;
}

/**
 * Exact rank comparator matching `private.quiz_ranked_candidates_v2`:
 * `(score DESC, elapsedMs ASC, submittedAtMs ASC, attemptId ASC)`.
 * Returns `< 0` if `a` ranks better (higher) than `b`.
 */
export function compareLiveRankKeys(
  a: LiveRankOrderingKey,
  b: LiveRankOrderingKey
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  if (a.submittedAtMs !== b.submittedAtMs)
    return a.submittedAtMs - b.submittedAtMs;
  if (a.attemptId < b.attemptId) return -1;
  if (a.attemptId > b.attemptId) return 1;
  return 0;
}

function toOrderingKey(entry: LiveRankOrderingKey): LiveRankOrderingKey {
  return {
    score: entry.score,
    elapsedMs: entry.elapsedMs,
    submittedAtMs: entry.submittedAtMs,
    attemptId: entry.attemptId,
  };
}

function binarySearchEntries(
  entries: readonly LiveRankEntry[],
  target: LiveRankOrderingKey
): { found: boolean; index: number } {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const item = entries[mid];
    if (!item) break;
    const cmp = compareLiveRankKeys(item, target);
    if (cmp < 0) {
      lo = mid + 1;
    } else if (cmp > 0) {
      hi = mid;
    } else {
      return { found: true, index: mid };
    }
  }
  return { found: false, index: lo };
}

function findRangeIndexForKey(
  ranges: readonly LiveRankRangeMeta[],
  key: LiveRankOrderingKey
): number {
  if (ranges.length === 0) return 0;
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const r = ranges[mid];
    if (!r) break;
    if (compareLiveRankKeys(key, r.maxKey) <= 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

const DEFAULT_TARGET_RANGE_SIZE = 250;
const DEFAULT_MAX_RANGE_SIZE = 500;

/**
 * Range-partitioned live rank index backed by SQLite.
 * Stores each customer's best eligible submission ONCE in `live_submissions` and
 * publishes `O(ranges * versions)` dirty sorted range blobs + 1 prefix-count manifest,
 * never `O(players * versions)` writes.
 */
export class LiveRankIndexEngine {
  private readonly storage: RoomStorageBackend;
  private readonly controlState: QuizControlStateStore;
  private readonly targetRangeSize: number;
  private readonly maxRangeSize: number;
  private schemaInitialized = false;

  // In-memory working buffer of ranges per event, persisted durably on publishSnapshot().
  private eventStates = new Map<
    string,
    {
      merchantId: string;
      version: number;
      nextRangeSeq: number;
      ranges: {
        rangeId: string;
        entries: LiveRankEntry[];
        dirty: boolean;
        version: number;
      }[];
      deletedRangeIds: Set<string>;
      dirtyStructure: boolean;
      customerCurrentEntry: Map<string, LiveRankEntry>;
      attemptToCustomer: Map<string, string>;
    }
  >();

  constructor(options: {
    storage: RoomStorageBackend;
    controlState?: QuizControlStateStore;
    targetRangeSize?: number;
    maxRangeSize?: number;
  }) {
    this.storage = options.storage;
    this.controlState = options.controlState ?? new QuizControlStateStore();
    this.targetRangeSize = options.targetRangeSize ?? DEFAULT_TARGET_RANGE_SIZE;
    this.maxRangeSize = options.maxRangeSize ?? DEFAULT_MAX_RANGE_SIZE;
  }

  private ensureSchemaSync(): void {
    if (this.schemaInitialized) return;
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS live_submissions (
        event_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        leaderboard_username TEXT NOT NULL,
        score INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL,
        submitted_at_ms INTEGER NOT NULL,
        attempt_status TEXT NOT NULL,
        PRIMARY KEY (event_id, customer_id)
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS live_rank_ranges (
        event_id TEXT NOT NULL,
        range_id TEXT NOT NULL,
        entries_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        PRIMARY KEY (event_id, range_id)
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS live_rank_manifest (
        event_id TEXT PRIMARY KEY,
        manifest_json TEXT NOT NULL
      ) WITHOUT ROWID;
    `);
    this.schemaInitialized = true;
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
  }

  private loadOrInitEventStateSync(eventId: string, merchantId?: string) {
    const existing = this.eventStates.get(eventId);
    if (existing) return existing;

    this.ensureSchemaSync();
    const manifestRow = this.storage.exec<ManifestRow>(
      `SELECT event_id, manifest_json FROM live_rank_manifest WHERE event_id = ?`,
      eventId
    ).rows[0];

    const ranges: {
      rangeId: string;
      entries: LiveRankEntry[];
      dirty: boolean;
      version: number;
    }[] = [];
    const customerCurrentEntry = new Map<string, LiveRankEntry>();
    const attemptToCustomer = new Map<string, string>();
    let version = 0;
    let maxSeq = 0;
    let resolvedMerchantId = merchantId ?? 'unknown';

    if (manifestRow) {
      const manifest = JSON.parse(
        manifestRow.manifest_json
      ) as LiveRankManifest;
      version = manifest.version;
      resolvedMerchantId = manifest.merchantId;
      for (const meta of manifest.ranges) {
        const rangeRow = this.storage.exec<RangeRow>(
          `SELECT range_id, entries_json, version FROM live_rank_ranges WHERE event_id = ? AND range_id = ?`,
          eventId,
          meta.rangeId
        ).rows[0];
        if (!rangeRow) continue;
        const entries = JSON.parse(rangeRow.entries_json) as LiveRankEntry[];
        ranges.push({
          rangeId: meta.rangeId,
          entries,
          dirty: false,
          version: rangeRow.version,
        });
        const seqNum = Number.parseInt(meta.rangeId.replace(/^r/, ''), 10);
        if (Number.isFinite(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
        for (const e of entries) {
          customerCurrentEntry.set(e.customerId, e);
          attemptToCustomer.set(e.attemptId, e.customerId);
        }
      }
    }

    const state = {
      merchantId: resolvedMerchantId,
      version,
      nextRangeSeq: maxSeq + 1,
      ranges,
      deletedRangeIds: new Set<string>(),
      dirtyStructure: false,
      customerCurrentEntry,
      attemptToCustomer,
    };

    // Replay any durably committed live_submissions (additions, updates, and
    // deletions) not yet reflected in the last published snapshot (e.g. after a
    // DO restart between write/remove and publish).
    const committedRows = this.storage.exec<SubmissionRow>(
      `SELECT * FROM live_submissions WHERE event_id = ?`,
      eventId
    ).rows;
    const committedCustomerIds = new Set(
      committedRows.map((row) => row.customer_id)
    );
    for (const snapshotEntry of [...state.customerCurrentEntry.values()]) {
      if (!committedCustomerIds.has(snapshotEntry.customerId)) {
        this.removeEntryFromRanges(state, snapshotEntry);
        state.customerCurrentEntry.delete(snapshotEntry.customerId);
        state.attemptToCustomer.delete(snapshotEntry.attemptId);
      }
    }
    for (const row of committedRows) {
      const existing = state.customerCurrentEntry.get(row.customer_id);
      const entry: LiveRankEntry = {
        customerId: row.customer_id,
        userId: row.user_id,
        merchantId: row.merchant_id,
        attemptId: row.attempt_id,
        leaderboardUsername: row.leaderboard_username,
        score: Number(row.score),
        elapsedMs: Number(row.elapsed_ms),
        submittedAtMs: Number(row.submitted_at_ms),
        attemptStatus: row.attempt_status === 'scored' ? 'scored' : 'submitted',
      };
      if (
        existing &&
        existing.attemptId === entry.attemptId &&
        existing.score === entry.score &&
        existing.elapsedMs === entry.elapsedMs &&
        existing.submittedAtMs === entry.submittedAtMs
      ) {
        continue;
      }
      if (state.merchantId === 'unknown' && entry.merchantId !== 'unknown') {
        state.merchantId = entry.merchantId;
      }
      if (existing) {
        this.removeEntryFromRanges(state, existing);
      }
      this.insertEntryIntoRanges(state, entry);
      state.customerCurrentEntry.set(entry.customerId, entry);
      state.attemptToCustomer.set(entry.attemptId, entry.customerId);
    }

    this.eventStates.set(eventId, state);
    return state;
  }

  private buildRangeMetas(
    ranges: ReadonlyArray<{
      rangeId: string;
      entries: LiveRankEntry[];
      version: number;
    }>
  ): LiveRankRangeMeta[] {
    const metas: LiveRankRangeMeta[] = [];
    for (const r of ranges) {
      const first = r.entries[0];
      const last = r.entries[r.entries.length - 1];
      if (!first || !last) continue;
      metas.push({
        rangeId: r.rangeId,
        minKey: first,
        maxKey: last,
        count: r.entries.length,
        prefixBeforeCount: 0,
        version: r.version,
      });
    }
    return metas;
  }

  private removeEntryFromRanges(
    state: NonNullable<
      ReturnType<LiveRankIndexEngine['loadOrInitEventStateSync']>
    >,
    entry: LiveRankEntry
  ): void {
    const metas = this.buildRangeMetas(state.ranges);
    const idx = findRangeIndexForKey(metas, entry);
    const range = state.ranges[idx];
    if (!range) {
      // Fallback linear check if ranges shifted
      for (let i = 0; i < state.ranges.length; i += 1) {
        const candidate = state.ranges[i];
        if (!candidate) continue;
        const pos = candidate.entries.findIndex(
          (e) => e.customerId === entry.customerId
        );
        if (pos !== -1) {
          candidate.entries.splice(pos, 1);
          candidate.dirty = true;
          state.dirtyStructure = true;
          if (candidate.entries.length === 0) {
            state.deletedRangeIds.add(candidate.rangeId);
            state.ranges.splice(i, 1);
          }
          return;
        }
      }
      return;
    }

    const pos = binarySearchEntries(range.entries, entry);
    if (pos.found) {
      range.entries.splice(pos.index, 1);
      range.dirty = true;
      state.dirtyStructure = true;
      if (range.entries.length === 0) {
        state.deletedRangeIds.add(range.rangeId);
        state.ranges.splice(idx, 1);
      }
    } else {
      const fallbackPos = range.entries.findIndex(
        (e) => e.customerId === entry.customerId
      );
      if (fallbackPos !== -1) {
        range.entries.splice(fallbackPos, 1);
        range.dirty = true;
        state.dirtyStructure = true;
        if (range.entries.length === 0) {
          state.deletedRangeIds.add(range.rangeId);
          state.ranges.splice(idx, 1);
        }
      }
    }
  }

  private insertEntryIntoRanges(
    state: NonNullable<
      ReturnType<LiveRankIndexEngine['loadOrInitEventStateSync']>
    >,
    entry: LiveRankEntry
  ): void {
    if (state.ranges.length === 0) {
      const rangeId = `r${state.nextRangeSeq}`;
      state.nextRangeSeq += 1;
      state.ranges.push({
        rangeId,
        entries: [entry],
        dirty: true,
        version: state.version,
      });
      state.dirtyStructure = true;
      return;
    }

    const metas = this.buildRangeMetas(state.ranges);
    const idx = Math.min(
      findRangeIndexForKey(metas, entry),
      state.ranges.length - 1
    );
    const targetRange = state.ranges[idx];
    if (!targetRange) return;

    const search = binarySearchEntries(targetRange.entries, entry);
    targetRange.entries.splice(search.index, 0, entry);
    targetRange.dirty = true;
    state.dirtyStructure = true;

    if (targetRange.entries.length > this.maxRangeSize) {
      // Split oversized leaf range into targetRangeSize chunks so 80%+ tie cohorts
      // never create an unbounded single range blob.
      const chunks: LiveRankEntry[][] = [];
      for (
        let i = 0;
        i < targetRange.entries.length;
        i += this.targetRangeSize
      ) {
        chunks.push(targetRange.entries.slice(i, i + this.targetRangeSize));
      }
      targetRange.entries = chunks[0] ?? [];
      targetRange.dirty = true;
      const insertedRanges = chunks.slice(1).map((chunk) => {
        const newId = `r${state.nextRangeSeq}`;
        state.nextRangeSeq += 1;
        return {
          rangeId: newId,
          entries: chunk,
          dirty: true,
          version: state.version,
        };
      });
      state.ranges.splice(idx + 1, 0, ...insertedRanges);
    }
  }

  private isSubmissionEligible(submission: QuizLiveRankSubmission): boolean {
    return !(
      this.controlState.isAttemptBlocked(
        submission.eventId,
        submission.attemptId,
        submission.customerId
      ) ||
      this.controlState.isAttemptDisqualified(submission.attemptId) ||
      this.controlState.isTesterRevoked(submission.eventId, submission.userId)
    );
  }

  private recordSubmissionInTxSync(submission: QuizLiveRankSubmission): {
    accepted: boolean;
    replacedPreviousBest: boolean;
  } {
    if (!this.isSubmissionEligible(submission)) {
      return { accepted: false, replacedPreviousBest: false };
    }

    const state = this.loadOrInitEventStateSync(
      submission.eventId,
      submission.merchantId
    );
    if (state.merchantId === 'unknown') {
      state.merchantId = submission.merchantId;
    }

    const candidate: LiveRankEntry = {
      customerId: submission.customerId,
      userId: submission.userId,
      merchantId: submission.merchantId,
      attemptId: submission.attemptId,
      leaderboardUsername: submission.leaderboardUsername.trim(),
      score: submission.score,
      elapsedMs: submission.elapsedMs,
      submittedAtMs: submission.submittedAtMs,
      attemptStatus: submission.attemptStatus,
    };

    const prev = state.customerCurrentEntry.get(submission.customerId);
    if (prev) {
      // Out-of-order / worse second attempt never overwrites a better eligible attempt.
      if (compareLiveRankKeys(candidate, prev) >= 0) {
        return { accepted: false, replacedPreviousBest: false };
      }
      this.removeEntryFromRanges(state, prev);
      state.attemptToCustomer.delete(prev.attemptId);
    }

    this.storage.exec(
      `INSERT INTO live_submissions (
        event_id, customer_id, user_id, merchant_id, attempt_id,
        leaderboard_username, score, elapsed_ms, submitted_at_ms, attempt_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, customer_id) DO UPDATE SET
        user_id = excluded.user_id,
        merchant_id = excluded.merchant_id,
        attempt_id = excluded.attempt_id,
        leaderboard_username = excluded.leaderboard_username,
        score = excluded.score,
        elapsed_ms = excluded.elapsed_ms,
        submitted_at_ms = excluded.submitted_at_ms,
        attempt_status = excluded.attempt_status`,
      submission.eventId,
      submission.customerId,
      submission.userId,
      submission.merchantId,
      submission.attemptId,
      candidate.leaderboardUsername,
      submission.score,
      submission.elapsedMs,
      submission.submittedAtMs,
      submission.attemptStatus
    );

    this.insertEntryIntoRanges(state, candidate);
    state.customerCurrentEntry.set(submission.customerId, candidate);
    state.attemptToCustomer.set(submission.attemptId, submission.customerId);
    return { accepted: true, replacedPreviousBest: prev !== undefined };
  }

  /**
   * Records an eligible submission. Stores the player's ordering key ONCE in
   * `live_submissions` (keeping only the best eligible attempt per customer)
   * and marks only the affected range(s) dirty for the next snapshot tick.
   */
  recordSubmission(submission: QuizLiveRankSubmission): {
    accepted: boolean;
    replacedPreviousBest: boolean;
  } {
    if (!this.isSubmissionEligible(submission)) {
      return { accepted: false, replacedPreviousBest: false };
    }
    return this.storage.transactionSync(() =>
      this.recordSubmissionInTxSync(submission)
    );
  }

  /**
   * Records a single-event batch of submissions in one SQLite transaction and
   * optionally publishes the updated range snapshot in the same call.
   * Throws `QUIZ_INVALID_INPUT` (400) before writing if multiple `eventId`s are mixed.
   */
  recordSubmissionsBatch(
    submissions: readonly QuizLiveRankSubmission[],
    publishNowMs?: number
  ): {
    acceptedCount: number;
    replacedCount: number;
    published: LiveRankPublishResult | null;
  } {
    if (submissions.length === 0) {
      return { acceptedCount: 0, replacedCount: 0, published: null };
    }
    const eventId = submissions[0]?.eventId;
    if (
      !eventId ||
      submissions.some((submission) => submission.eventId !== eventId)
    ) {
      throw new QuizRoomError(
        'QUIZ_INVALID_INPUT',
        'recordSubmissionsBatch requires a single non-empty eventId across all submissions',
        400
      );
    }
    return this.storage.transactionSync(() => {
      let acceptedCount = 0;
      let replacedCount = 0;
      for (const submission of submissions) {
        const res = this.recordSubmissionInTxSync(submission);
        if (res.accepted) acceptedCount += 1;
        if (res.replacedPreviousBest) replacedCount += 1;
      }
      const published =
        publishNowMs !== undefined
          ? this.publishSnapshotInTxSync(eventId, publishNowMs)
          : null;
      return { acceptedCount, replacedCount, published };
    });
  }

  /**
   * Removes a blocked, disqualified, or revoked attempt from the live rank index.
   */
  removeAttempt(eventId: string, attemptId: string): boolean {
    return this.storage.transactionSync(() => {
      const state = this.loadOrInitEventStateSync(eventId);
      const customerId = state.attemptToCustomer.get(attemptId);
      if (!customerId) return false;
      const entry = state.customerCurrentEntry.get(customerId);
      if (!entry || entry.attemptId !== attemptId) return false;

      this.removeEntryFromRanges(state, entry);
      state.customerCurrentEntry.delete(customerId);
      state.attemptToCustomer.delete(attemptId);
      this.storage.exec(
        `DELETE FROM live_submissions WHERE event_id = ? AND customer_id = ?`,
        eventId,
        customerId
      );
      return true;
    });
  }

  /**
   * Publishes a new range-partitioned snapshot version.
   * Writes ONLY dirty ranges + 1 manifest (`O(ranges)`), and writes 0 rows when
   * nothing changed since the previous version.
   */
  publishSnapshot(eventId: string, nowMs = Date.now()): LiveRankPublishResult {
    return this.storage.transactionSync(() =>
      this.publishSnapshotInTxSync(eventId, nowMs)
    );
  }

  private publishSnapshotInTxSync(
    eventId: string,
    nowMs: number
  ): LiveRankPublishResult {
    const state = this.loadOrInitEventStateSync(eventId);
    const dirtyRanges = state.ranges.filter((r) => r.dirty);
    if (
      !state.dirtyStructure &&
      dirtyRanges.length === 0 &&
      state.deletedRangeIds.size === 0
    ) {
      return {
        version: state.version,
        published: false,
        dirtyRangesWritten: 0,
        totalRanges: state.ranges.length,
        totalEntries: state.customerCurrentEntry.size,
        rowsWrittenThisTick: 0,
        bytesWrittenThisTick: 0,
      };
    }

    const nextVersion = state.version + 1;
    let rowsWrittenThisTick = 0;
    let bytesWrittenThisTick = 0;

    for (const deletedId of state.deletedRangeIds) {
      const res = this.storage.exec(
        `DELETE FROM live_rank_ranges WHERE event_id = ? AND range_id = ?`,
        eventId,
        deletedId
      );
      rowsWrittenThisTick += res.rowsWritten;
    }
    state.deletedRangeIds.clear();

    const encoder = new TextEncoder();
    for (const range of dirtyRanges) {
      range.version = nextVersion;
      range.dirty = false;
      const encoded = JSON.stringify(range.entries);
      bytesWrittenThisTick += encoder.encode(encoded).byteLength;
      const res = this.storage.exec(
        `INSERT INTO live_rank_ranges (event_id, range_id, entries_json, version)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(event_id, range_id) DO UPDATE SET
           entries_json = excluded.entries_json,
           version = excluded.version`,
        eventId,
        range.rangeId,
        encoded,
        nextVersion
      );
      rowsWrittenThisTick += res.rowsWritten;
    }

    let prefixBeforeCount = 0;
    const rangeMetas: LiveRankRangeMeta[] = [];
    for (const range of state.ranges) {
      const first = range.entries[0];
      const last = range.entries[range.entries.length - 1];
      if (!first || !last) continue;
      rangeMetas.push({
        rangeId: range.rangeId,
        minKey: toOrderingKey(first),
        maxKey: toOrderingKey(last),
        count: range.entries.length,
        prefixBeforeCount,
        version: range.version,
      });
      prefixBeforeCount += range.entries.length;
    }

    const manifest: LiveRankManifest = {
      eventId,
      merchantId: state.merchantId,
      version: nextVersion,
      totalCount: prefixBeforeCount,
      updatedAtMs: nowMs,
      ranges: rangeMetas,
    };
    const manifestEncoded = JSON.stringify(manifest);
    bytesWrittenThisTick += encoder.encode(manifestEncoded).byteLength;
    const manifestRes = this.storage.exec(
      `INSERT INTO live_rank_manifest (event_id, manifest_json)
       VALUES (?, ?)
       ON CONFLICT(event_id) DO UPDATE SET manifest_json = excluded.manifest_json`,
      eventId,
      manifestEncoded
    );
    rowsWrittenThisTick += manifestRes.rowsWritten;

    state.version = nextVersion;
    state.dirtyStructure = false;

    return {
      version: nextVersion,
      published: true,
      dirtyRangesWritten: dirtyRanges.length,
      totalRanges: rangeMetas.length,
      totalEntries: prefixBeforeCount,
      rowsWrittenThisTick,
      bytesWrittenThisTick,
    };
  }

  getPublishedManifest(eventId: string): LiveRankManifest | null {
    this.ensureSchemaSync();
    const row = this.storage.exec<ManifestRow>(
      `SELECT event_id, manifest_json FROM live_rank_manifest WHERE event_id = ?`,
      eventId
    ).rows[0];
    if (!row) return null;
    return JSON.parse(row.manifest_json) as LiveRankManifest;
  }

  /**
   * Resolves a single player's exact tie-broken rank against the published range
   * snapshot: 1 read for player's ordering key + 1 manifest read + 1 range blob read.
   */
  getPlayerPosition(
    eventId: string,
    customerId: string,
    expectedMerchantId?: string
  ): {
    version: number;
    rank: number;
    entry: LiveRankEntry;
    totalCount: number;
  } | null {
    this.ensureSchemaSync();
    const subRow = this.storage.exec<SubmissionRow>(
      `SELECT * FROM live_submissions WHERE event_id = ? AND customer_id = ?`,
      eventId,
      customerId
    ).rows[0];
    if (!subRow) return null;
    if (expectedMerchantId && subRow.merchant_id !== expectedMerchantId) {
      throw new QuizRoomError('QZ031', 'not_authorized', 403);
    }

    const manifest = this.getPublishedManifest(eventId);
    if (!manifest || manifest.ranges.length === 0) return null;

    const targetKey: LiveRankOrderingKey = {
      score: subRow.score,
      elapsedMs: subRow.elapsed_ms,
      submittedAtMs: subRow.submitted_at_ms,
      attemptId: subRow.attempt_id,
    };

    const rangeIdx = Math.min(
      findRangeIndexForKey(manifest.ranges, targetKey),
      manifest.ranges.length - 1
    );
    const rangeMeta = manifest.ranges[rangeIdx];
    if (!rangeMeta) return null;

    const rangeRow = this.storage.exec<RangeRow>(
      `SELECT range_id, entries_json, version FROM live_rank_ranges WHERE event_id = ? AND range_id = ?`,
      eventId,
      rangeMeta.rangeId
    ).rows[0];
    if (!rangeRow) return null;

    const entries = JSON.parse(rangeRow.entries_json) as LiveRankEntry[];
    const search = binarySearchEntries(entries, targetKey);
    if (!search.found) return null;
    const foundEntry = entries[search.index];
    if (!foundEntry) return null;

    return {
      version: manifest.version,
      rank: rangeMeta.prefixBeforeCount + search.index + 1,
      entry: foundEntry,
      totalCount: manifest.totalCount,
    };
  }

  private readonly lastPrunedControlMarker = new Map<string, string>();

  private pruneRestrictedAttemptsForEvent(eventId: string): void {
    const marker = `${this.controlState.getVersion()}:${this.controlState.getUpdatedAtMs()}`;
    if (this.lastPrunedControlMarker.get(eventId) === marker) {
      return;
    }
    const snapshot = this.controlState.getSnapshot();
    const restrictedAttemptIds = new Set<string>([
      ...snapshot.blockedAttemptIds,
      ...snapshot.disqualifiedAttemptIds,
    ]);
    const eventPrefix = `${eventId}:`;
    const blockedCustomerIds = snapshot.blockedCustomerKeys
      .filter((k) => k.startsWith(eventPrefix))
      .map((k) => k.slice(eventPrefix.length));
    const revokedUserIds = snapshot.revokedTesterKeys
      .filter((k) => k.startsWith(eventPrefix))
      .map((k) => k.slice(eventPrefix.length));

    if (
      restrictedAttemptIds.size === 0 &&
      blockedCustomerIds.length === 0 &&
      revokedUserIds.length === 0
    ) {
      this.lastPrunedControlMarker.set(eventId, marker);
      return;
    }

    this.ensureSchemaSync();
    for (const customerId of blockedCustomerIds) {
      const row = this.storage.exec<{ attempt_id: string }>(
        `SELECT attempt_id FROM live_submissions WHERE event_id = ? AND customer_id = ?`,
        eventId,
        customerId
      ).rows[0];
      if (row) restrictedAttemptIds.add(row.attempt_id);
    }
    for (const userId of revokedUserIds) {
      const rows = this.storage.exec<{ attempt_id: string }>(
        `SELECT attempt_id FROM live_submissions WHERE event_id = ? AND user_id = ?`,
        eventId,
        userId
      ).rows;
      for (const row of rows) {
        restrictedAttemptIds.add(row.attempt_id);
      }
    }

    let prunedCount = 0;
    for (const attemptId of restrictedAttemptIds) {
      if (this.removeAttempt(eventId, attemptId)) {
        prunedCount += 1;
      }
    }
    if (prunedCount > 0) {
      this.publishSnapshot(eventId, Date.now());
    }
    this.lastPrunedControlMarker.set(eventId, marker);
  }

  /**
   * Serves the shared live leaderboard view (top-100 + caller's `currentPlayer`)
   * with merchant isolation, tester revocation check, and <60s identity masking.
   */
  async getLiveLeaderboard(options: {
    eventId: string;
    merchantId: string;
    callerCustomerId: string;
    callerUserId: string;
    isTestEvent?: boolean;
    limit?: number;
  }): Promise<QuizLeaderboardApiResponse> {
    if (this.controlState.isEventCancelled(options.eventId)) {
      return {
        status: 'unavailable',
        entries: [],
        currentPlayer: null,
        participantCount: 0,
      };
    }
    if (
      this.controlState.isTesterRevoked(options.eventId, options.callerUserId)
    ) {
      throw new QuizRoomError('QZ031', 'not_authorized', 403);
    }

    this.pruneRestrictedAttemptsForEvent(options.eventId);

    const manifest = this.getPublishedManifest(options.eventId);
    if (!manifest) {
      return {
        status: 'live',
        entries: [],
        currentPlayer: null,
        participantCount: 0,
      };
    }
    if (
      manifest.merchantId !== 'unknown' &&
      manifest.merchantId !== options.merchantId
    ) {
      throw new QuizRoomError('QZ031', 'not_authorized', 403);
    }

    const limit = Math.min(100, Math.max(1, options.limit ?? 100));
    const topRaw: { rank: number; entry: LiveRankEntry }[] = [];

    for (const meta of manifest.ranges) {
      if (topRaw.length >= limit) break;
      const rangeRow = this.storage.exec<RangeRow>(
        `SELECT range_id, entries_json, version FROM live_rank_ranges WHERE event_id = ? AND range_id = ?`,
        options.eventId,
        meta.rangeId
      ).rows[0];
      if (!rangeRow) continue;
      const entries = JSON.parse(rangeRow.entries_json) as LiveRankEntry[];
      for (let i = 0; i < entries.length && topRaw.length < limit; i += 1) {
        const item = entries[i];
        if (!item) continue;
        topRaw.push({
          rank: meta.prefixBeforeCount + i + 1,
          entry: item,
        });
      }
    }

    const projectEntry = async (
      rank: number,
      item: LiveRankEntry
    ): Promise<QuizLeaderboardApiEntry> => {
      const displayName = await this.controlState.resolveDisplayName(
        options.eventId,
        item.attemptId,
        item.customerId,
        item.leaderboardUsername
      );
      return {
        displayName,
        isCurrentCustomer: item.customerId === options.callerCustomerId,
        rank,
        score: item.score,
        status: item.attemptStatus,
        submittedAt: new Date(item.submittedAtMs).toISOString(),
        totalTimeSeconds: item.elapsedMs / 1000,
      };
    };

    const entries: QuizLeaderboardApiEntry[] = [];
    let currentPlayerInTop = false;
    for (const row of topRaw) {
      const projected = await projectEntry(row.rank, row.entry);
      if (projected.isCurrentCustomer) currentPlayerInTop = true;
      entries.push(projected);
    }

    let currentPlayer: QuizLeaderboardApiEntry | null = null;
    if (!currentPlayerInTop) {
      const pos = this.getPlayerPosition(
        options.eventId,
        options.callerCustomerId,
        options.merchantId
      );
      if (pos) {
        currentPlayer = await projectEntry(pos.rank, pos.entry);
      }
    }

    return {
      status: 'live',
      entries,
      currentPlayer,
      participantCount: manifest.totalCount,
    };
  }
}
