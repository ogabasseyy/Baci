import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

/**
 * Overlap applied when a watermark probe fails: the worker and database
 * clocks can disagree, so a worker-derived fallback floor looks this far
 * back to avoid skipping rows the failed probe would have covered.
 */
const QUIZ_SWEEP_CLOCK_SKEW_MARGIN_MS = 2 * 60 * 1000;

type QuizClient = SupabaseClient<Database>;

/** Per-table sweep floors, all in the database clock domain when probed. */
export interface QuizSweepWatermarks {
  /** `quiz_events.updated_at` sweep floor. */
  events: string;
  /** `quiz_prize_reservations.updated_at` sweep floor. */
  reservations: string;
  /** `quiz_awards.expired_at` sweep floor. */
  awards: string;
}

async function probeTableMaxTimestamp(
  client: QuizClient,
  table: 'quiz_awards' | 'quiz_events' | 'quiz_prize_reservations',
  column: 'expired_at' | 'updated_at'
): Promise<string | null> {
  try {
    // Dynamic table/column union the generated types cannot express; the
    // result is validated below and any miss falls back to the overlapped
    // worker floor.
    const loose = client as unknown as SupabaseClient;
    let query = loose.from(table).select(column);
    if (column === 'expired_at') {
      query = query.not(column, 'is', null);
    }
    const { data, error } = await query
      .order(column, { ascending: false })
      .limit(1);
    if (error) return null;
    const rows = (data ?? []) as Record<string, unknown>[];
    const value = rows[0]?.[column];
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Resolve per-table sweep watermarks from the database clock. The worker
 * clock can run ahead of the database clock, in which case a worker-derived
 * watermark is newer than the `clock_timestamp()` values the finalization
 * RPCs just wrote — the `.gte()` sweeps would omit this run's rows, and the
 * next run's even newer watermark would never revisit them. Probing each
 * table's current maximum keeps every watermark in the same clock domain as
 * the column it filters (a separate floor per table also avoids one quiet
 * table dragging the shared floor into a full re-sweep). A failed or empty
 * probe falls back to the worker start minus an overlap margin: bounded
 * over-invalidation instead of a silent skip.
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
    probeTableMaxTimestamp(client, 'quiz_events', 'updated_at'),
    probeTableMaxTimestamp(client, 'quiz_prize_reservations', 'updated_at'),
    probeTableMaxTimestamp(client, 'quiz_awards', 'expired_at'),
  ]);
  return {
    events: events ?? fallback,
    reservations: reservations ?? fallback,
    awards: awards ?? fallback,
  };
}
