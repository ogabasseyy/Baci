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

  it('still pages when no shared store answers (falls back to this copy)', async () => {
    expect(await claimDegradedPage('transfers', 1, async () => null)).toBe(
      true
    );
  });

  it('reports no shared store when Redis is not configured', async () => {
    expect(await claimSharedPage('transfers:1')).toBeNull();
  });
});
