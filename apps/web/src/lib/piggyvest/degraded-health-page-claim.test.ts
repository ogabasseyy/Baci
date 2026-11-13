import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));

import {
  claimDegradedPage,
  claimSharedPage,
  resetDegradedPageClaims,
} from './degraded-health-page-claim';

beforeEach(() => resetDegradedPageClaims());

const HOUR = 3_600_000;
const MIN = 60_000;
const none = async () => null;

describe('claimDegradedPage', () => {
  it('pages once per reason in a rolling hour within a server copy', async () => {
    const shared = vi.fn(async () => true);
    expect(await claimDegradedPage('transfers', shared, HOUR)).toBe(true);
    expect(await claimDegradedPage('transfers', shared, HOUR + 5 * MIN)).toBe(
      false
    );
    expect(await claimDegradedPage('other', shared, HOUR + 5 * MIN)).toBe(true);
    expect(await claimDegradedPage('transfers', shared, 2 * HOUR)).toBe(true);
  });

  describe('bugfix: every server copy paged the same incident', () => {
    it('does not page when another copy already claimed the reason', async () => {
      const shared = vi.fn(async () => false);
      expect(await claimDegradedPage('transfers', shared, HOUR)).toBe(false);
      expect(shared).toHaveBeenCalledWith('transfers');
    });
  });

  describe('bugfix: a refused claim pushed the next page past the shared expiry', () => {
    it('keeps the earlier mark when another copy still holds the claim', async () => {
      const held = vi.fn(async () => false);
      const ok = vi.fn(async () => true);
      expect(await claimDegradedPage('transfers', ok, HOUR)).toBe(true);
      // 50 minutes on: the local gap has passed but Redis still holds it.
      expect(await claimDegradedPage('transfers', held, HOUR + 50 * MIN)).toBe(
        false
      );
      // Once the shared claim has expired, the next run pages.
      expect(await claimDegradedPage('transfers', ok, HOUR + 60 * MIN)).toBe(
        true
      );
    });
  });

  describe('bugfix: two pages minutes apart across an hour boundary', () => {
    it('never pages twice within the hour, whatever the clock hour', async () => {
      const shared = vi.fn(async () => true);
      expect(
        await claimDegradedPage('transfers', shared, HOUR + 29 * MIN)
      ).toBe(true);
      expect(
        await claimDegradedPage('transfers', shared, HOUR + 31 * MIN)
      ).toBe(false);
    });
  });

  describe('bugfix: without Redis a fresh server copy paged every 5-minute run', () => {
    it('pages from the top-of-hour run when no shared store answers', async () => {
      expect(await claimDegradedPage('transfers', none, HOUR + 2 * MIN)).toBe(
        true
      );
    });

    it('does not page from later runs in the hour, even on a fresh copy', async () => {
      for (const minute of [5, 10, 30, 55]) {
        resetDegradedPageClaims();
        expect(
          await claimDegradedPage('transfers', none, HOUR + minute * MIN)
        ).toBe(false);
      }
    });

    it('still pages from the top-of-hour run when the cron fires a little early or late', async () => {
      expect(await claimDegradedPage('early', none, 2 * HOUR - MIN)).toBe(true);
      expect(await claimDegradedPage('late', none, HOUR + 140_000)).toBe(true);
      expect(await claimDegradedPage('next', none, HOUR + 3 * MIN)).toBe(false);
    });

    it('pages again at the next top of the hour, even when that run is early', async () => {
      expect(await claimDegradedPage('transfers', none, HOUR + MIN)).toBe(true);
      expect(await claimDegradedPage('transfers', none, 2 * HOUR - MIN)).toBe(
        true
      );
    });

    it('asks Redis again next run after a transient outage outside the window', async () => {
      expect(await claimDegradedPage('transfers', none, HOUR + 20 * MIN)).toBe(
        false
      );
      const recovered = vi.fn(async () => true);
      expect(
        await claimDegradedPage('transfers', recovered, HOUR + 25 * MIN)
      ).toBe(true);
      expect(recovered).toHaveBeenCalledWith('transfers');
    });
  });

  it('reports no shared store when Redis is not configured', async () => {
    expect(await claimSharedPage('transfers')).toBeNull();
  });
});
