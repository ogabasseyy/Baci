import { describe, expect, it } from 'vitest';
import { deriveWindowLastSyncedAt } from './reporting-freshness';

describe('deriveWindowLastSyncedAt', () => {
  it('retains the supplied fallback when no window bounds are available', () => {
    expect(deriveWindowLastSyncedAt([], '2026-08-22T09:00:00.000Z')).toBe(
      '2026-08-22T09:00:00.000Z'
    );
    expect(deriveWindowLastSyncedAt([], null)).toBeNull();
  });

  it('uses the oldest valid row timestamp for a populated window', () => {
    expect(
      deriveWindowLastSyncedAt(
        [
          { fetched_at: '2026-08-22T09:00:00.000Z' },
          { fetched_at: '2026-08-20T09:00:00.000Z' },
        ],
        '2026-08-27T09:00:00.000Z'
      )
    ).toBe('2026-08-20T09:00:00.000Z');
  });

  it('fails closed when populated rows have no valid timestamps', () => {
    expect(
      deriveWindowLastSyncedAt(
        [{ fetched_at: null }, { fetched_at: 'not-a-timestamp' }],
        '2026-08-27T09:00:00.000Z'
      )
    ).toBeNull();
  });
});
