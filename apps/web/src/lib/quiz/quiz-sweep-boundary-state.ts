export type QuizWatermarkTable =
  | 'quiz_awards'
  | 'quiz_events'
  | 'quiz_prize_reservations';

export type QuizTableProbeStatus = 'ok' | 'empty' | 'error';

/** Per-table sweep floor and pre-RPC boundary state snapshot. */
export interface QuizTableSweepWatermark {
  status: QuizTableProbeStatus;
  floor: string;
  boundarySnapshots: ReadonlyMap<string, string>;
}

/** Per-table sweep floors, all in the database clock domain when probed. */
export interface QuizSweepWatermarks {
  /** `quiz_events.updated_at` sweep state. */
  events: QuizTableSweepWatermark;
  /** `quiz_prize_reservations.updated_at` sweep state. */
  reservations: QuizTableSweepWatermark;
  /** `quiz_awards.expired_at` sweep state. */
  awards: QuizTableSweepWatermark;
  /** True when any table probe or boundary snapshot query failed. */
  hasProbeFailure: boolean;
}

export const QUIZ_SWEEP_TABLE_SELECT = {
  quiz_events:
    'id, updated_at, merchant_id, status, finalization_state, finalization_error_code, attempts_terminalized_at, award_finalized_at, results_published_at, settings',
  quiz_prize_reservations:
    'id, updated_at, merchant_id, product_id, variant_id, inventory_unit_id, quantity, state, award_id, release_reason, released_at, transferred_at',
  quiz_awards:
    'id, expired_at, event_id, product_id, variant_id, status, claimed_at, claim_expires_at, reserved_order_id, reserved_order_item_id, quiz_events!inner(merchant_id)',
} as const satisfies Record<QuizWatermarkTable, string>;

export function toCanonicalIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = canonicalizeJsonValue(record[key]);
  }
  return sorted;
}

function extractAwardMerchantId(row: Record<string, unknown>): unknown {
  const embedded = row.quiz_events;
  if (embedded && typeof embedded === 'object' && !Array.isArray(embedded)) {
    return (embedded as Record<string, unknown>).merchant_id ?? null;
  }
  return null;
}

/**
 * Compute a deterministic fingerprint of cache-relevant row state so an
 * existing boundary row updated in place at the exact same timestamp is still
 * detected and swept, while unmodified boundary rows are skipped.
 */
export function serializeBoundaryRowState(
  table: QuizWatermarkTable,
  row: Record<string, unknown>
): string {
  switch (table) {
    case 'quiz_events':
      return JSON.stringify(
        canonicalizeJsonValue({
          attempts_terminalized_at:
            toCanonicalIsoTimestamp(row.attempts_terminalized_at) ??
            row.attempts_terminalized_at ??
            null,
          award_finalized_at:
            toCanonicalIsoTimestamp(row.award_finalized_at) ??
            row.award_finalized_at ??
            null,
          finalization_error_code: row.finalization_error_code ?? null,
          finalization_state: row.finalization_state ?? null,
          id: row.id ?? null,
          merchant_id: row.merchant_id ?? null,
          results_published_at:
            toCanonicalIsoTimestamp(row.results_published_at) ??
            row.results_published_at ??
            null,
          settings: row.settings ?? null,
          status: row.status ?? null,
          updated_at:
            toCanonicalIsoTimestamp(row.updated_at) ?? row.updated_at ?? null,
        })
      );
    case 'quiz_prize_reservations':
      return JSON.stringify(
        canonicalizeJsonValue({
          award_id: row.award_id ?? null,
          id: row.id ?? null,
          inventory_unit_id: row.inventory_unit_id ?? null,
          merchant_id: row.merchant_id ?? null,
          product_id: row.product_id ?? null,
          quantity: row.quantity ?? null,
          release_reason: row.release_reason ?? null,
          released_at:
            toCanonicalIsoTimestamp(row.released_at) ?? row.released_at ?? null,
          state: row.state ?? null,
          transferred_at:
            toCanonicalIsoTimestamp(row.transferred_at) ??
            row.transferred_at ??
            null,
          updated_at:
            toCanonicalIsoTimestamp(row.updated_at) ?? row.updated_at ?? null,
          variant_id: row.variant_id ?? null,
        })
      );
    case 'quiz_awards':
      return JSON.stringify(
        canonicalizeJsonValue({
          claim_expires_at:
            toCanonicalIsoTimestamp(row.claim_expires_at) ??
            row.claim_expires_at ??
            null,
          claimed_at:
            toCanonicalIsoTimestamp(row.claimed_at) ?? row.claimed_at ?? null,
          event_id: row.event_id ?? null,
          expired_at:
            toCanonicalIsoTimestamp(row.expired_at) ?? row.expired_at ?? null,
          id: row.id ?? null,
          merchant_id: extractAwardMerchantId(row),
          product_id: row.product_id ?? null,
          reserved_order_id: row.reserved_order_id ?? null,
          reserved_order_item_id: row.reserved_order_item_id ?? null,
          status: row.status ?? null,
          variant_id: row.variant_id ?? null,
        })
      );
  }
}

export function shouldSkipUnchangedBoundaryRow(
  table: QuizWatermarkTable,
  timestampColumn: 'expired_at' | 'updated_at',
  watermark: QuizTableSweepWatermark,
  row: Record<string, unknown>
): boolean {
  if (watermark.boundarySnapshots.size === 0) {
    return false;
  }
  const rowId = typeof row.id === 'string' ? row.id.trim() : '';
  if (!rowId) {
    return false;
  }
  const rowTimestamp = toCanonicalIsoTimestamp(row[timestampColumn]);
  const floorTimestamp = toCanonicalIsoTimestamp(watermark.floor);
  if (!rowTimestamp || !floorTimestamp || rowTimestamp !== floorTimestamp) {
    return false;
  }
  const previousSnapshot = watermark.boundarySnapshots.get(rowId);
  if (previousSnapshot === undefined) {
    return false;
  }
  return previousSnapshot === serializeBoundaryRowState(table, row);
}

function hasTableFloorChanged(
  previousFloor: string,
  currentFloor: string
): boolean {
  const canonicalPrevious = toCanonicalIsoTimestamp(previousFloor);
  const canonicalCurrent = toCanonicalIsoTimestamp(currentFloor);
  if (canonicalPrevious !== null && canonicalCurrent !== null) {
    return canonicalPrevious !== canonicalCurrent;
  }
  return previousFloor !== currentFloor;
}

function hasTableWatermarkChanged(
  previous: QuizTableSweepWatermark,
  current: QuizTableSweepWatermark
): boolean {
  if (
    previous.status !== current.status ||
    hasTableFloorChanged(previous.floor, current.floor)
  ) {
    return true;
  }
  if (previous.boundarySnapshots.size !== current.boundarySnapshots.size) {
    return true;
  }
  for (const [id, snapshot] of current.boundarySnapshots) {
    if (previous.boundarySnapshots.get(id) !== snapshot) {
      return true;
    }
  }
  return false;
}

/**
 * Detect whether any table's watermark floor, probe status, or boundary
 * snapshot changed since the previous tick (for example, due to the
 * database-side `run_quiz_deadline_clock_v2` pg_cron job or another writer).
 */
export function hasQuizSweepWatermarksChanged(
  previous: QuizSweepWatermarks,
  current: QuizSweepWatermarks
): boolean {
  return (
    hasTableWatermarkChanged(previous.events, current.events) ||
    hasTableWatermarkChanged(previous.reservations, current.reservations) ||
    hasTableWatermarkChanged(previous.awards, current.awards)
  );
}
