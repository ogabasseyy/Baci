import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));

import {
  claimDegradedPage,
  claimSharedPage,
  resetDegradedPageClaims,
} from './degraded-health-page-claim';

beforeEach(() => resetDegradedPageClaims());

describe('claimDegradedPage', () => {
  it('pages once per reason per hour within a server copy', async () => {
    const shared = vi.fn(async () => true);
    expect(await claimDegradedPage('transfers', 1, shared)).toBe(true);
    expect(await claimDegradedPage('transfers', 1, shared)).toBe(false);
    expect(await claimDegradedPage('transfers', 2, shared)).toBe(true);
  });

  describe('bugfix: every server copy paged the same incident', () => {
    it('does not page when another copy already claimed the hour', async () => {
      const shared = vi.fn(async () => false);
      expect(await claimDegradedPage('transfers', 1, shared)).toBe(false);
      expect(shared).toHaveBeenCalledWith('transfers:1');
    });
  });

  describe('bugfix: without Redis a fresh server copy paged every 5-minute run', () => {
    const HOUR = 3_600_000;
    const none = async () => null;

    it('pages from the first run of the hour when no shared store answers', async () => {
      expect(
        await claimDegradedPage('transfers', 1, none, HOUR + 2 * 60_000)
      ).toBe(true);
    });

    it('does not page from later runs in the hour, even on a fresh copy', async () => {
      for (const minute of [5, 10, 30, 55]) {
        resetDegradedPageClaims();
        expect(
          await claimDegradedPage('transfers', 1, none, HOUR + minute * 60_000)
        ).toBe(false);
      }
    });

    it('still pages from the top-of-hour run when the cron fires a little early or late', async () => {
      expect(await claimDegradedPage('early', 1, none, 2 * HOUR - 60_000)).toBe(
        true
      );
      expect(await claimDegradedPage('late', 1, none, HOUR + 140_000)).toBe(
        true
      );
      expect(await claimDegradedPage('next', 1, none, HOUR + 3 * 60_000)).toBe(
        false
      );
    });

    it('asks Redis again next run after a transient outage outside the window', async () => {
      expect(
        await claimDegradedPage('transfers', 1, none, HOUR + 20 * 60_000)
      ).toBe(false);
      const recovered = vi.fn(async () => true);
      expect(
        await claimDegradedPage('transfers', 1, recovered, HOUR + 25 * 60_000)
      ).toBe(true);
      expect(recovered).toHaveBeenCalledWith('transfers:1');
    });

    it('still trusts the shared store when it answers', async () => {
      expect(
        await claimDegradedPage(
          'transfers',
          1,
          async () => true,
          HOUR + 30 * 60_000
        )
      ).toBe(true);
    });
  });

  it('reports no shared store when Redis is not configured', async () => {
    expect(await claimSharedPage('transfers:1')).toBeNull();
  });
});
