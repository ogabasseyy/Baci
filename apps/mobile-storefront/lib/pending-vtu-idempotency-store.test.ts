import { hashVtuScopeDescriptor } from '@baci/shared';
import { jest } from '@jest/globals';
import { scopePendingVtuKey } from './pending-vtu-idempotency';
import {
  clearForgottenVtuScopes,
  forgottenVtuScopes,
  loadPendingVtuSnapshot,
  noteForgottenVtuScopes,
  parsePendingVtuSnapshot,
  persistPendingVtuEntries,
  serializePendingVtuEntries,
} from './pending-vtu-idempotency-store';

const mockMmkvStore = new Map<string, string>();
let mockMmkvSetThrows = false;

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => mockMmkvStore.get(key) ?? null,
    set: (key: string, value: string) => {
      if (mockMmkvSetThrows) {
        throw new Error('MMKV full');
      }
      mockMmkvStore.set(key, value);
    },
    remove: (key: string) => {
      mockMmkvStore.delete(key);
    },
  }),
}));

function entry(overrides: Record<string, unknown> = {}) {
  return {
    key: 'k',
    reference: null,
    rememberedAt: Date.now(),
    completedAt: null,
    ...overrides,
  };
}

describe('pending-vtu-idempotency-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMmkvStore.clear();
    mockMmkvSetThrows = false;
    clearForgottenVtuScopes();
  });

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

  it('drops TTL-expired entries on serialize and parse', () => {
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    expect(
      serializePendingVtuEntries([['a', entry()]], [], Date.now() + weekMs + 1)
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
        JSON.stringify([['a', entry({ reference: 'REF-A', rememberedAt: 1 })]])
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
  });

  it('round-trips tombstones and suppresses tombstoned generations', () => {
    const now = Date.now();
    const serialized = serializePendingVtuEntries(
      [
        ['old', entry({ key: 'key-old', rememberedAt: now - 2000 })],
        ['new', entry({ key: 'key-new', rememberedAt: now })],
      ],
      [{ scoped: 'old', forgottenAt: now - 1000 }],
      now
    );

    expect(parsePendingVtuSnapshot(serialized, now)).toEqual({
      entries: [['new', entry({ key: 'key-new', rememberedAt: now })]],
      forgotten: [{ scoped: 'old', forgottenAt: now - 1000 }],
    });
  });

  it('keeps a re-remembered entry newer than its tombstone', () => {
    const now = Date.now();
    const serialized = serializePendingVtuEntries(
      [['a', entry({ key: 'key-new', rememberedAt: now })]],
      [{ scoped: 'a', forgottenAt: now - 1000 }],
      now
    );

    expect(parsePendingVtuSnapshot(serialized, now).entries).toHaveLength(1);
  });

  it('prunes TTL-expired tombstones on serialize and parse', () => {
    const serialized = serializePendingVtuEntries(
      [],
      [{ scoped: 'a', forgottenAt: 1 }],
      Date.now()
    );

    expect(parsePendingVtuSnapshot(serialized).forgotten).toEqual([]);
  });

  it('persist wrapper clears tombstones after a durable write', () => {
    noteForgottenVtuScopes(['a'], Date.now());

    expect(persistPendingVtuEntries([])).toBe(true);
    expect(forgottenVtuScopes.size).toBe(0);
    expect(
      parsePendingVtuSnapshot(loadPendingVtuSnapshot()).forgotten
    ).toHaveLength(1);
  });

  it('persist wrapper retains tombstones when the write throws', () => {
    mockMmkvSetThrows = true;
    noteForgottenVtuScopes(['a'], Date.now());

    expect(persistPendingVtuEntries([])).toBe(false);
    expect(forgottenVtuScopes.size).toBe(1);
    expect(loadPendingVtuSnapshot()).toBeNull();
  });

  it('migrates legacy raw scope keys to digests on parse', () => {
    const legacyEntry = 'merchant-1:user-1:{"phoneNumber":"08030000000"}';
    const legacyTombstone = 'merchant-1:user-1:{"phoneNumber":"08030000002"}';
    const rememberedAt = Date.now();
    const parsed = parsePendingVtuSnapshot(
      JSON.stringify({
        entries: [[legacyEntry, entry({ rememberedAt })]],
        forgotten: [{ scoped: legacyTombstone, forgottenAt: rememberedAt }],
      })
    );

    expect(parsed.entries).toEqual([
      [hashVtuScopeDescriptor(legacyEntry), entry({ rememberedAt })],
    ]);
    expect(parsed.forgotten).toEqual([
      {
        scoped: hashVtuScopeDescriptor(legacyTombstone),
        forgottenAt: rememberedAt,
      },
    ]);
  });

  it('still suppresses a legacy entry under its legacy tombstone', () => {
    const legacy = 'merchant-1:user-1:{"phoneNumber":"08030000001"}';
    const parsed = parsePendingVtuSnapshot(
      JSON.stringify({
        entries: [[legacy, entry({ rememberedAt: 1000 })]],
        forgotten: [{ scoped: legacy, forgottenAt: 2000 }],
      }),
      3000
    );

    expect(parsed.entries).toEqual([]);
    expect(parsed.forgotten[0].scoped).toBe(hashVtuScopeDescriptor(legacy));
  });

  it('writes fresh snapshots with no plaintext identifiers', () => {
    const scoped = scopePendingVtuKey(
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
