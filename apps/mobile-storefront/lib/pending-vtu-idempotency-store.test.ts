import {
  parsePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './pending-vtu-idempotency-store';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    key: 'k',
    reference: null,
    rememberedAt: Date.now(),
    ...overrides,
  };
}

describe('pending-vtu-idempotency-store', () => {
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
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    expect(
      serializePendingVtuEntries([['a', entry()]], Date.now() + weekMs + 1)
    ).toBe('[]');

    expect(
      parsePendingVtuSnapshot(
        JSON.stringify([['a', entry({ rememberedAt: 1 })]])
      )
    ).toEqual([]);
  });

  it('drops TTL-expired entries of any reference state on serialize and parse', () => {
    // Uniform 7-day horizon: no client-side signal proves terminality, so
    // referenced entries expire exactly like reference-less ones —
    // mirrors live recall.
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const expired = entry({ reference: 'REF-A' });

    expect(
      parsePendingVtuSnapshot(
        serializePendingVtuEntries([['a', expired]], Date.now() + weekMs + 1)
      )
    ).toEqual([]);

    expect(
      parsePendingVtuSnapshot(
        JSON.stringify([['a', entry({ reference: 'REF-A', rememberedAt: 1 })]])
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
