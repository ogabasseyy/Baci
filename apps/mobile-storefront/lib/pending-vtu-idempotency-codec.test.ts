import { hashVtuScopeDescriptor } from '@baci/shared';
import { scopePendingVtuKey } from './pending-vtu-descriptor';
import {
  hasLegacyVtuScopeKeys,
  parsePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './pending-vtu-idempotency-codec';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    key: 'k',
    reference: null,
    rememberedAt: Date.now(),
    completedAt: null,
    ...overrides,
  };
}

describe('pending-vtu-idempotency-codec', () => {
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

  it('drops TTL-expired completed entries on serialize and parse', () => {
    // Only OBSERVED completion expires past the TTL (Codex R63
    // 6ruGlp): uncompleted entries — answered or not — may still
    // resolve server-side, so they outlive the horizon.
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const done = entry({ completedAt: Date.now() });

    expect(
      serializePendingVtuEntries([['a', done]], [], Date.now() + weekMs + 1)
    ).toBe('{"entries":[],"forgotten":[]}');

    expect(
      parsePendingVtuSnapshot(
        JSON.stringify([['a', entry({ rememberedAt: 1, completedAt: 2 })]])
      )
    ).toEqual({ entries: [], forgotten: [] });
  });

  it('retains uncompleted entries past the TTL on serialize and parse', () => {
    // Codex R61 6rtSNk + R63 6ruGlp: referenced-processing AND
    // unanswered entries may still resolve server-side (a lost
    // response leaves the reference null after a committed debit),
    // so the TTL must not delete their key mapping — the retry
    // would mint fresh and double-debit. Only completed entries
    // still drop.
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const parsed = parsePendingVtuSnapshot(
      serializePendingVtuEntries(
        [
          ['a', entry({ reference: 'REF-A' })],
          ['b', entry()],
          ['c', entry({ reference: 'REF-C', completedAt: Date.now() })],
        ],
        [],
        Date.now() + weekMs + 1
      )
    );
    expect(parsed.entries.map(([scoped]) => scoped)).toEqual(['a', 'b']);

    // Legacy raw snapshots get the same retention on parse.
    const legacy = parsePendingVtuSnapshot(
      JSON.stringify([
        ['a', entry({ reference: 'REF-A', rememberedAt: 1 })],
        ['b', entry({ rememberedAt: 1 })],
        ['c', entry({ rememberedAt: 1, completedAt: 2 })],
      ])
    );
    expect(legacy.entries.map(([scoped]) => scoped)).toEqual(['a', 'b']);
  });

  it('expires observed completions from completion, not submit', () => {
    // Codex R69 6rxZFN: a transaction processing past the submit TTL
    // then completing must still replay — expiring from rememberedAt
    // would mint fresh and debit twice for a delivered vend.
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const parsed = parsePendingVtuSnapshot(
      serializePendingVtuEntries(
        [
          // Submitted 8d ago, completed 1d ago: retained.
          [
            'a',
            entry({
              rememberedAt: now - 8 * dayMs,
              completedAt: now - dayMs,
            }),
          ],
          // Submitted 9d ago, completed 8d ago: expired.
          [
            'b',
            entry({
              rememberedAt: now - 9 * dayMs,
              completedAt: now - 8 * dayMs,
            }),
          ],
        ],
        [],
        now
      )
    );
    expect(parsed.entries.map(([scoped]) => scoped)).toEqual(['a']);
  });

  it('round-trips scope tags, leaving pre-tag snapshots untagged', () => {
    // Codex R62 6rtokd: the owner-scoped settle filter needs the tag
    // to survive restarts; pre-tag snapshots parse untagged (fail open).
    const parsed = parsePendingVtuSnapshot(
      serializePendingVtuEntries(
        [
          ['a', entry({ scopeTag: 'tag-1' })],
          ['b', entry()],
        ],
        []
      )
    );
    expect(parsed.entries[0][1].scopeTag).toBe('tag-1');
    expect(parsed.entries[1][1].scopeTag).toBeUndefined();

    const legacy = parsePendingVtuSnapshot(
      JSON.stringify([
        [
          'a',
          {
            key: 'k',
            reference: 'REF-A',
            rememberedAt: Date.now(),
            completedAt: null,
          },
        ],
      ])
    );
    expect(legacy.entries[0][1].scopeTag).toBeUndefined();
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

  it('flags snapshots still holding raw scope keys', () => {
    const legacy = 'merchant-1:user-1:{"phoneNumber":"08030000000"}';
    const rememberedAt = Date.now();
    expect(
      hasLegacyVtuScopeKeys(
        JSON.stringify({
          entries: [[legacy, entry({ rememberedAt })]],
          forgotten: [],
        })
      )
    ).toBe(true);
    expect(
      hasLegacyVtuScopeKeys(
        JSON.stringify({
          entries: [],
          forgotten: [{ scoped: legacy, forgottenAt: rememberedAt }],
        })
      )
    ).toBe(true);
    expect(
      hasLegacyVtuScopeKeys(JSON.stringify([[legacy, entry({ rememberedAt })]]))
    ).toBe(true);
  });

  it('ignores digests, bare keys, and corrupt snapshots', () => {
    const digest = hashVtuScopeDescriptor('m:u:{"a":1}');
    const rememberedAt = Date.now();
    expect(
      hasLegacyVtuScopeKeys(
        JSON.stringify({
          entries: [[digest, entry({ rememberedAt })]],
          forgotten: [{ scoped: digest, forgottenAt: rememberedAt }],
        })
      )
    ).toBe(false);
    expect(
      hasLegacyVtuScopeKeys(
        JSON.stringify({
          entries: [['a', entry({ rememberedAt })]],
          forgotten: [],
        })
      )
    ).toBe(false);
    expect(hasLegacyVtuScopeKeys(null)).toBe(false);
    expect(hasLegacyVtuScopeKeys('not-json')).toBe(false);
  });
});
