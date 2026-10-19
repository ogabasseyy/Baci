/**
 * Derive the freshness timestamp for a requested spend window.
 *
 * A connection's marker describes the last completed sync, not the range that
 * a dashboard query is rendering. When rows are present, the oldest valid
 * row timestamp is the conservative boundary: a window containing any older
 * rows must not be presented as fresh just because another range was synced
 * recently. Empty windows retain the connection marker because a successful
 * provider response can legitimately contain no activity rows.
 */
export function deriveWindowLastSyncedAt(
  rows: ReadonlyArray<{ fetched_at: string | null | undefined }>,
  fallback: string | null
): string | null {
  if (rows.length === 0) return fallback;

  let oldest: { timestamp: number; value: string } | undefined;
  for (const row of rows) {
    if (!row.fetched_at) continue;
    const timestamp = Date.parse(row.fetched_at);
    if (!Number.isFinite(timestamp)) continue;
    if (!oldest || timestamp < oldest.timestamp) {
      oldest = { timestamp, value: row.fetched_at };
    }
  }

  return oldest?.value ?? null;
}
