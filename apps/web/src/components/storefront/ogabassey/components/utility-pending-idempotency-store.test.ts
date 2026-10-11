import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingVtuSnapshot,
  loadPendingVtuSnapshot,
  parsePendingVtuSnapshot,
  savePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './utility-pending-idempotency-store';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    key: 'k',
    reference: null,
    rememberedAt: Date.now(),
    ...overrides,
  };
}

describe('utility-pending-idempotency-store', () => {
  it('round-trips live entries through serialize and parse', () => {
    const rememberedAt = Date.now();
    const serialized = serializePendingVtuEntries([
      ['a', entry({ key: 'key-a', reference: 'REF-A', rememberedAt })],
      ['b', entry({ key: 'key-b', rememberedAt })],
    ]);

    expect(parsePendingVtuSnapshot(serialized)).toEqual([
      ['a', entry({ key: 'key-a', reference: 'REF-A', rememberedAt })],
      ['b', entry({ key: 'key-b', rememberedAt })],
    ]);
  });

  it('drops TTL-expired entries on serialize and parse', () => {
    const dayMs = 24 * 60 * 60 * 1000;

    expect(
      serializePendingVtuEntries(
        [['a', entry()]],
        Date.now() + dayMs + 1
      )
    ).toBe('[]');

    expect(
      parsePendingVtuSnapshot(
        JSON.stringify([['a', entry({ rememberedAt: 1 })]])
      )
    ).toEqual([]);
  });

  it('drops TTL-expired entries of any reference state on serialize and parse', () => {
    // Uniform 24h horizon: no client-side signal proves terminality, so
    // referenced entries expire exactly like reference-less ones —
    // mirrors live recall.
    const dayMs = 24 * 60 * 60 * 1000;
    const expired = entry({ reference: 'REF-A' });

    expect(
      parsePendingVtuSnapshot(
        serializePendingVtuEntries([['a', expired]], Date.now() + dayMs + 1)
      )
    ).toEqual([]);

    expect(
      parsePendingVtuSnapshot(
        JSON.stringify([
          ['a', entry({ reference: 'REF-A', rememberedAt: 1 })],
        ])
      )
    ).toEqual([]);
  });

  it('ignores corrupt snapshots on parse', () => {
    expect(parsePendingVtuSnapshot('{oops')).toEqual([]);
    expect(parsePendingVtuSnapshot('"just-a-string"')).toEqual([]);
    expect(parsePendingVtuSnapshot(null)).toEqual([]);
    expect(
      parsePendingVtuSnapshot(JSON.stringify([['nope'], [42, {}], null]))
    ).toEqual([]);
  });
});

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
