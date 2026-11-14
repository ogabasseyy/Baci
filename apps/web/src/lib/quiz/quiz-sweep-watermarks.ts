import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

/**
 * Overlap applied when a watermark probe fails: the worker and database
 * clocks can disagree, so a worker-derived fallback floor looks this far
 * back to avoid skipping rows the failed probe would have covered.
 */
const QUIZ_SWEEP_CLOCK_SKEW_MARGIN_MS = 2 * 60 * 1000;
const QUIZ_EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const BOUNDARY_SNAPSHOT_PAGE_SIZE = 1000;

type QuizClient = SupabaseClient<Database>;

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

async function collectBoundarySnapshots(
  client: QuizClient,
  table: QuizWatermarkTable,
  column: 'expired_at' | 'updated_at',
  boundaryTimestamp: string
): Promise<Map<string, string> | null> {
  const snapshots = new Map<string, string>();
  const loose = client as unknown as SupabaseClient;

  for (let page = 0; ; page += 1) {
    const from = page * BOUNDARY_SNAPSHOT_PAGE_SIZE;
    const to = (page + 1) * BOUNDARY_SNAPSHOT_PAGE_SIZE - 1;
    const selectColumns: string = QUIZ_SWEEP_TABLE_SELECT[table];
    let query = loose.from(table).select(selectColumns);
    if (typeof (query as { eq?: unknown }).eq !== 'function') {
      // Minimal probe-only mock without boundary query support: fail safe with
      // an empty snapshot map so boundary rows are not skipped erroneously.
      return snapshots;
    }
    query = query.eq(column, boundaryTimestamp);
    if (typeof (query as { order?: unknown }).order === 'function') {
      query = query.order('id', { ascending: true });
    }
    if (typeof (query as { range?: unknown }).range === 'function') {
      query = query.range(from, to);
    }

    const result = await (query as unknown as PromiseLike<{
      data: unknown[] | null;
      error: unknown;
    }>);
    if (result.error) {
      return null;
    }
    const rows = (result.data ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      if (typeof row.id === 'string' && row.id.trim().length > 0) {
        snapshots.set(row.id.trim(), serializeBoundaryRowState(table, row));
      }
    }
    if (
      typeof (query as { range?: unknown }).range !== 'function' ||
      rows.length < BOUNDARY_SNAPSHOT_PAGE_SIZE
    ) {
      return snapshots;
    }
  }
}

async function probeTableWatermark(
  client: QuizClient,
  table: QuizWatermarkTable,
  column: 'expired_at' | 'updated_at',
  fallback: string
): Promise<QuizTableSweepWatermark> {
  try {
    const loose = client as unknown as SupabaseClient;
    let query = loose.from(table).select(column);
    if (column === 'expired_at') {
      query = query.not(column, 'is', null);
    }
    const { data, error } = await query
      .order(column, { ascending: false })
      .limit(1);
    if (error) {
      return {
        status: 'error',
        floor: fallback,
        boundarySnapshots: new Map(),
      };
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) {
      return {
        status: 'empty',
        floor: QUIZ_EPOCH_ISO,
        boundarySnapshots: new Map(),
      };
    }

    const value = rows[0]?.[column];
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      return {
        status: 'error',
        floor: fallback,
        boundarySnapshots: new Map(),
      };
    }

    const boundarySnapshots = await collectBoundarySnapshots(
      client,
      table,
      column,
      value
    );
    if (boundarySnapshots === null) {
      return {
        status: 'error',
        floor: value,
        boundarySnapshots: new Map(),
      };
    }

    return {
      status: 'ok',
      floor: value,
      boundarySnapshots,
    };
  } catch {
    return {
      status: 'error',
      floor: fallback,
      boundarySnapshots: new Map(),
    };
  }
}

/**
 * Resolve per-table sweep watermarks and pre-RPC boundary state snapshots
 * from the database clock before running finalization RPCs. Distinguishes
 * empty tables (`status: 'empty'`) from failed probes (`status: 'error'`) so
 * callers only skip sweeps when probes actually succeeded and RPCs made no
 * mutations.
 */
export async function resolveQuizSweepWatermarks(
  client: QuizClient,
  fallbackBaseIso: string
): Promise<QuizSweepWatermarks> {
  const fallbackBase = Date.parse(fallbackBaseIso);
  const fallback = new Date(
    (Number.isNaN(fallbackBase) ? Date.now() : fallbackBase) -
      QUIZ_SWEEP_CLOCK_SKEW_MARGIN_MS
  ).toISOString();
  const [events, reservations, awards] = await Promise.all([
    probeTableWatermark(client, 'quiz_events', 'updated_at', fallback),
    probeTableWatermark(
      client,
      'quiz_prize_reservations',
      'updated_at',
      fallback
    ),
    probeTableWatermark(client, 'quiz_awards', 'expired_at', fallback),
  ]);
  return {
    events,
    reservations,
    awards,
    hasProbeFailure:
      events.status === 'error' ||
      reservations.status === 'error' ||
      awards.status === 'error',
  };
}
