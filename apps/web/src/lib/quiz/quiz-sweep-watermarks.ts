import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import {
  QUIZ_SWEEP_TABLE_SELECT,
  type QuizSweepWatermarks,
  type QuizTableProbeStatus,
  type QuizTableSweepWatermark,
  type QuizWatermarkTable,
  serializeBoundaryRowState,
  toCanonicalIsoTimestamp,
} from './quiz-sweep-boundary-state';

export {
  QUIZ_SWEEP_TABLE_SELECT,
  type QuizSweepWatermarks,
  type QuizTableProbeStatus,
  type QuizTableSweepWatermark,
  type QuizWatermarkTable,
  serializeBoundaryRowState,
  toCanonicalIsoTimestamp,
};

/**
 * Overlap applied when a watermark probe fails: the worker and database
 * clocks can disagree, so a worker-derived fallback floor looks this far
 * back to avoid skipping rows the failed probe would have covered.
 */
const QUIZ_SWEEP_CLOCK_SKEW_MARGIN_MS = 2 * 60 * 1000;
const QUIZ_EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const BOUNDARY_SNAPSHOT_PAGE_SIZE = 1000;
/**
 * Cap pre-RPC boundary snapshot pagination so a bulk import sharing a single
 * timestamp cannot trigger unbounded queries on every tick. Exceeding the cap
 * returns `null` (fail-closed to `status: 'error'` while keeping the DB floor).
 */
const MAX_BOUNDARY_SNAPSHOT_PAGES = 5;

type QuizClient = SupabaseClient<Database>;

async function collectBoundarySnapshots(
  client: QuizClient,
  table: QuizWatermarkTable,
  column: 'expired_at' | 'updated_at',
  boundaryTimestamp: string
): Promise<Map<string, string> | null> {
  const snapshots = new Map<string, string>();
  const loose = client as unknown as SupabaseClient;

  for (let page = 0; page < MAX_BOUNDARY_SNAPSHOT_PAGES; page += 1) {
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
    const hasRange = typeof (query as { range?: unknown }).range === 'function';
    if (hasRange) {
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
    if (!hasRange || rows.length < BOUNDARY_SNAPSHOT_PAGE_SIZE) {
      return snapshots;
    }
  }

  // Exceeded MAX_BOUNDARY_SNAPSHOT_PAGES: fail closed so we conservatively sweep.
  return null;
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
