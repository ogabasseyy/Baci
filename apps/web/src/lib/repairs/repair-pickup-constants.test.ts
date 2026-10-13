import { describe, expect, it } from 'vitest';
import {
  REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS,
  REPAIR_PICKUP_PROVIDER,
} from './repair-pickup-constants';

describe('REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS', () => {
  it('is 15 minutes and matches the claim RPC default (p_lock_timeout_seconds = 900)', () => {
    // Must stay in sync with migration 20260711171500's default (900s); the
    // status route derives its stale-lock cutoff from this value, and the pickup
    // claim RPC uses the same window, so drift would desynchronize the two.
    expect(REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS).toBe(15 * 60);
    expect(REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS).toBe(900);
  });

  it('uses GIGL for provider-backed repair collection', () => {
    expect(REPAIR_PICKUP_PROVIDER).toBe('GIGL');
  });
});
