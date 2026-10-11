import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingVtuKeys,
  forgetPendingVtuPurchase,
  getPendingVtuKey,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';

describe('utility-pending-idempotency', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  it('mints a key on first submit and recalls it for the same purchase', () => {
    const first = getPendingVtuKey('{"amount":100}');

    expect(first).toBeTruthy();
    expect(getPendingVtuKey('{"amount":100}')).toBe(first);
  });

  it('mints distinct keys for distinct purchases', () => {
    const airtime = getPendingVtuKey('{"type":"airtime"}');
    const data = getPendingVtuKey('{"type":"data"}');

    expect(airtime).not.toBe(data);
  });

  it('forgets a terminal purchase so a repeat buy mints fresh', () => {
    const first = getPendingVtuKey('{"amount":100}');
    forgetPendingVtuPurchase('{"amount":100}');

    expect(recallPendingVtuKey('{"amount":100}')).toBeUndefined();
    expect(getPendingVtuKey('{"amount":100}')).not.toBe(first);
  });

  it('evicts the oldest entry past the cap instead of growing unbounded', () => {
    const signatures = Array.from(
      { length: 33 },
      (_, index) => `{"n":${index}}`
    );
    const keys = signatures.map((signature) => getPendingVtuKey(signature));

    // First entry evicted: recall misses and a fresh key is minted.
    expect(recallPendingVtuKey(signatures[0])).toBeUndefined();
    // Newest entries still recall.
    expect(recallPendingVtuKey(signatures[32])).toBe(keys[32]);
  });

  it('remembering an existing signature does not evict or rotate it', () => {
    const key = getPendingVtuKey('{"amount":100}');
    rememberPendingVtuPurchase('{"amount":100}', key);

    expect(recallPendingVtuKey('{"amount":100}')).toBe(key);
  });
});
