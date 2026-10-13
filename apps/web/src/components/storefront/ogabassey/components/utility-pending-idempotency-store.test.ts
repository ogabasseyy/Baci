import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingVtuSnapshot,
  loadPendingVtuSnapshot,
  savePendingVtuSnapshot,
} from './utility-pending-idempotency-store';

describe('pending VTU snapshot backend', () => {
  beforeEach(() => {
    clearPendingVtuSnapshot();
    localStorage.clear();
  });

  it('persists snapshots in localStorage so a new tab recalls the key', () => {
    // Tab-scoped storage would mint a fresh key on new-tab retry and
    // the route would debit a second transaction.
    savePendingVtuSnapshot('{"probe":true}');

    expect(loadPendingVtuSnapshot()).toBe('{"probe":true}');
    expect(localStorage.length).toBe(1);

    clearPendingVtuSnapshot();
    expect(loadPendingVtuSnapshot()).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
