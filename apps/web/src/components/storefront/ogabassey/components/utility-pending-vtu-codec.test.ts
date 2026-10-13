import { hashVtuScopeDescriptor } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import {
  hasLegacyVtuScopeKeys,
  parsePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './utility-pending-vtu-codec';
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

describe('utility-pending-vtu-codec', () => {
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

  it('retains referenced-processing entries past the TTL on serialize and parse', () => {
    // Codex R61 6rtSNk: a referenced but never-terminally-observed
    // entry is still resolvable (the server keeps provider-unknown
    // rows processing indefinitely), so the TTL must not delete the
    // only client mapping to the original key — the retry would mint
    // fresh and double-debit. Unreferenced and completed entries
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
    expect(parsed.entries.map(([scoped]) => scoped)).toEqual(['a']);
    expect(parsed.entries[0][1].reference).toBe('REF-A');

    // Legacy raw snapshots get the same retention on parse.
    const legacy = parsePendingVtuSnapshot(
      JSON.stringify([
        ['a', entry({ reference: 'REF-A', rememberedAt: 1 })],
        ['b', entry({ rememberedAt: 1 })],
      ])
    );
    expect(legacy.entries.map(([scoped]) => scoped)).toEqual(['a']);
  });

  it('round-trips scope tags, leaving pre-tag snapshots untagged', () => {
    // Codex R62 6rtokd: the owner-scoped settle filter needs the tag
    // to survive reloads; pre-tag snapshots parse untagged (fail open).
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
    // Bare-array legacy shape.
    expect(
      hasLegacyVtuScopeKeys(
        JSON.stringify([[legacy, entry({ rememberedAt })]])
      )
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
          forgotten: [{ scoped: 'gone', forgottenAt: rememberedAt }],
        })
      )
    ).toBe(false);
    expect(hasLegacyVtuScopeKeys(null)).toBe(false);
    expect(hasLegacyVtuScopeKeys('not-json')).toBe(false);
    expect(hasLegacyVtuScopeKeys('{"entries":{}}')).toBe(false);
  });

  it('round-trips the tombstone key generation binding', () => {
    const rememberedAt = Date.now();
    const serialized = serializePendingVtuEntries(
      [],
      [{ scoped: 'a', forgottenAt: rememberedAt, key: 'key-K1' }]
    );
    const parsed = parsePendingVtuSnapshot(serialized);

    expect(parsed.forgotten).toEqual([
      { scoped: 'a', forgottenAt: rememberedAt, key: 'key-K1' },
    ]);
  });

  it('degrades malformed tombstone keys to keyless', () => {
    const rememberedAt = Date.now();
    const parsed = parsePendingVtuSnapshot(
      JSON.stringify({
        entries: [],
        forgotten: [{ scoped: 'a', forgottenAt: rememberedAt, key: 42 }],
      })
    );

    // Deletion intent preserved; timestamp arbitration applies.
    expect(parsed.forgotten).toEqual([
      { scoped: 'a', forgottenAt: rememberedAt },
    ]);
  });
});
