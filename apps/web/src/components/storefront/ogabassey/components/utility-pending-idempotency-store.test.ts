import { hashVtuScopeDescriptor } from '@baci/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingVtuSnapshot,
  loadPendingVtuSnapshot,
  parsePendingVtuSnapshot,
  savePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './utility-pending-idempotency-store';
import { scopePendingVtuSignature } from './utility-pending-idempotency';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    key: 'k',
    reference: null,
    rememberedAt: Date.now(),
    completedAt: null,
    ...overrides,
  };
}

describe('utility-pending-idempotency-store', () => {
  it('round-trips live entries through serialize and parse', () => {
    const rememberedAt = Date.now();
    const serialized = serializePendingVtuEntries(
      [
        ['a', entry({ key: 'key-a', reference: 'REF-A', rememberedAt })],
        ['b', entry({ key: 'key-b', rememberedAt })],
      ],
      []
    );

    expect(parsePendingVtuSnapshot(serialized)).toEqual({
      entries: [
        ['a', entry({ key: 'key-a', reference: 'REF-A', rememberedAt })],
        ['b', entry({ key: 'key-b', rememberedAt })],
      ],
      forgotten: [],
    });
  });

  it('drops TTL-expired entries on serialize and parse', () => {
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    expect(
      serializePendingVtuEntries(
        [['a', entry()]],
        [],
        Date.now() + weekMs + 1
      )
    ).toBe('{"entries":[],"forgotten":[]}');

    expect(
      parsePendingVtuSnapshot(
        JSON.stringify([['a', entry({ rememberedAt: 1 })]])
      )
    ).toEqual({ entries: [], forgotten: [] });
  });

  it('drops TTL-expired entries of any reference state on serialize and parse', () => {
    // Uniform 7-day horizon: no client-side signal proves terminality, so
    // referenced entries expire exactly like reference-less ones —
    // mirrors live recall.
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const expired = entry({ reference: 'REF-A' });

    expect(
      parsePendingVtuSnapshot(
        serializePendingVtuEntries(
          [['a', expired]],
          [],
          Date.now() + weekMs + 1
        )
      )
    ).toEqual({ entries: [], forgotten: [] });

    expect(
      parsePendingVtuSnapshot(
        JSON.stringify([
          ['a', entry({ reference: 'REF-A', rememberedAt: 1 })],
        ])
      )
    ).toEqual({ entries: [], forgotten: [] });
  });

  it('ignores corrupt snapshots on parse', () => {
    const empty = { entries: [], forgotten: [] };
    expect(parsePendingVtuSnapshot('{oops')).toEqual(empty);
    expect(parsePendingVtuSnapshot('"just-a-string"')).toEqual(empty);
    expect(parsePendingVtuSnapshot(null)).toEqual(empty);
    expect(
      parsePendingVtuSnapshot(JSON.stringify([['nope'], [42, {}], null]))
    ).toEqual(empty);
    expect(parsePendingVtuSnapshot(JSON.stringify({ entries: {} }))).toEqual(
      empty
    );
  });

  it('round-trips deletion tombstones and parses legacy bare-array snapshots', () => {
    const now = Date.now();
    const serialized = serializePendingVtuEntries(
      [],
      [{ scoped: 'gone', forgottenAt: now }],
      now
    );

    expect(parsePendingVtuSnapshot(serialized, now)).toEqual({
      entries: [],
      forgotten: [{ scoped: 'gone', forgottenAt: now }],
    });
    // Legacy format (entries only, no tombstones) still parses.
    expect(
      parsePendingVtuSnapshot(
        JSON.stringify([['a', entry({ rememberedAt: now })]]),
        now
      )
    ).toEqual({
      entries: [['a', entry({ rememberedAt: now })]],
      forgotten: [],
    });
  });

  it('round-trips completion timestamps; legacy entries default to null', () => {
    const now = Date.now();
    const serialized = serializePendingVtuEntries(
      [['a', entry({ completedAt: now - 1000 })]],
      []
    );

    expect(parsePendingVtuSnapshot(serialized, now)).toEqual({
      entries: [['a', entry({ completedAt: now - 1000 })]],
      forgotten: [],
    });
    // Pre-completion-tracking snapshots omit the field: fail open so
    // the first replay presents success instead of "Already Completed".
    const legacy = { key: 'k', reference: null, rememberedAt: now };
    expect(
      parsePendingVtuSnapshot(JSON.stringify([['a', legacy]]), now)
    ).toEqual({
      entries: [['a', entry({ rememberedAt: now, completedAt: null })]],
      forgotten: [],
    });
  });

  it('drops TTL-expired tombstones on serialize and parse', () => {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    expect(
      parsePendingVtuSnapshot(
        serializePendingVtuEntries(
          [],
          [{ scoped: 'old', forgottenAt: now }],
          now + weekMs + 1
        ),
        now + weekMs + 1
      )
    ).toEqual({ entries: [], forgotten: [] });

    expect(
      parsePendingVtuSnapshot(
        JSON.stringify({
          entries: [],
          forgotten: [{ scoped: 'old', forgottenAt: 1 }],
        }),
        now
      )
    ).toEqual({ entries: [], forgotten: [] });
  });

  it('migrates legacy raw scope keys to digests on parse', () => {
    const legacy = 'merchant-1:user-1:{"phoneNumber":"08030000000"}';
    const rememberedAt = Date.now();
    const parsed = parsePendingVtuSnapshot(
      JSON.stringify({
        entries: [[legacy, entry({ rememberedAt })]],
        forgotten: [{ scoped: legacy, forgottenAt: rememberedAt }],
      })
    );
    const digest = hashVtuScopeDescriptor(legacy);

    expect(parsed.entries).toEqual([[digest, entry({ rememberedAt })]]);
    expect(parsed.forgotten).toEqual([
      { scoped: digest, forgottenAt: rememberedAt },
    ]);
  });

  it('writes fresh snapshots with no plaintext identifiers', () => {
    const scoped = scopePendingVtuSignature(
      'user-1',
      'merchant-1',
      '{"phoneNumber":"08030000000"}'
    );
    expect(scoped).toMatch(/^[0-9a-f]{64}$/);
    const serialized = serializePendingVtuEntries([[scoped, entry()]], []);

    expect(serialized).not.toContain('08030000000');
    expect(serialized).not.toContain('merchant-1');
    expect(serialized).not.toContain('user-1');
    expect(parsePendingVtuSnapshot(serialized).entries[0][0]).toBe(scoped);
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
