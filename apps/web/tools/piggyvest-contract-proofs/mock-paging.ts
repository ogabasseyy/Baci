/**
 * Cursor paging for the mock's lists, with the broken behaviours a live
 * provider might show. `advance` is the honest one; the others let a proof be
 * checked against a pager that LOOKS like it moves but does not.
 */

export type PagingMode =
  | 'advance'
  /** Every follow-up page repeats the first rows under a fresh, never-repeated cursor. */
  | 'rotating_cursor_same_rows'
  /** Every page hands back the same next cursor. */
  | 'stuck_cursor';

export interface PageWindow {
  /** First row index of the rows returned. */
  start: number;
  end: number;
  hasNextPage: boolean;
  endCursor: string | null;
  previousCursor: string | null;
}

export function pageWindow(
  mode: PagingMode,
  cursor: string | null,
  limit: number,
  total: number
): PageWindow {
  const requested = Number(cursor ?? 0) || 0;
  const start = mode === 'rotating_cursor_same_rows' ? 0 : requested;
  const end = Math.min(total, start + limit);
  // Where the cursor claims to point next.
  const next =
    mode === 'rotating_cursor_same_rows'
      ? Math.min(total, requested + limit)
      : mode === 'stuck_cursor'
        ? Math.min(total, limit)
        : end;
  const hasNextPage = mode === 'advance' ? end < total : next < total;
  return {
    start,
    end,
    hasNextPage,
    endCursor: hasNextPage ? String(next) : null,
    previousCursor:
      requested > 0 ? String(Math.max(0, requested - limit)) : null,
  };
}
