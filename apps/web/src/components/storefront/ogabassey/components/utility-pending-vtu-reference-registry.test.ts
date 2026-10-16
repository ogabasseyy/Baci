import { beforeEach, describe, expect, it } from 'vitest';
import { buildPendingVtuScopeTag } from '@baci/shared';
import {
  clearPendingVtuKeys,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import { scopePendingVtuSignature } from './utility-pending-vtu-scope';
import {
  loadPendingVtuSnapshot,
  savePendingVtuSnapshot,
} from './utility-pending-idempotency-store';
import {
  hasNotedPendingVtuReference,
  listNotedPendingVtuReferences,
  notePendingVtuReference,
} from './utility-pending-vtu-reference-registry';
import {
  parsePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './utility-pending-vtu-codec';

describe('utility-pending-vtu-reference-registry', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  it('notes a provider reference onto a retained entry (Codex R143 P1)', () => {
    rememberPendingVtuPurchase('{"registry":"note"}', 'key-note');

    expect(
      hasNotedPendingVtuReference('{"registry":"note"}', 'REF-NOTE')
    ).toBe(false);
    notePendingVtuReference('{"registry":"note"}', 'REF-NOTE');

    expect(
      hasNotedPendingVtuReference('{"registry":"note"}', 'REF-NOTE')
    ).toBe(true);
    expect(
      hasNotedPendingVtuReference('{"registry":"note"}', 'REF-OTHER')
    ).toBe(false);
    expect(listNotedPendingVtuReferences()).toEqual(['REF-NOTE']);
  });

  it('no-ops when noting onto a missing entry (Codex R143 P1)', () => {
    expect(() =>
      notePendingVtuReference('{"registry":"missing"}', 'REF-GHOST')
    ).not.toThrow();
    expect(
      hasNotedPendingVtuReference('{"registry":"missing"}', 'REF-GHOST')
    ).toBe(false);
    expect(listNotedPendingVtuReferences()).toEqual([]);
  });

  it('persists the noted reference to the snapshot (Codex R143 P1)', () => {
    // Scoped (digest) signature: raw colon-bearing fixtures would
    // migrate-on-read into a second map entry on the syncing persist.
    const scoped = scopePendingVtuSignature(
      'user-1',
      'merchant-1',
      '{"registry":"persist"}'
    );
    rememberPendingVtuPurchase(scoped, 'key-persist');
    notePendingVtuReference(scoped, 'REF-PERSIST');

    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.[1].reference).toBe('REF-PERSIST');
  });

  it('syncs sibling-tab references before listing (Codex R143 P1)', () => {
    // Sibling tab's snapshot lands in shared storage while this
    // tab's memory is empty (beforeEach cleared both).
    const scoped = scopePendingVtuSignature(
      'user-1',
      'merchant-1',
      '{"registry":"sibling"}'
    );
    savePendingVtuSnapshot(
      serializePendingVtuEntries(
        [
          [
            scoped,
            {
              key: 'key-sibling',
              reference: 'REF-SIBLING',
              rememberedAt: Date.now(),
              completedAt: null,
            },
          ],
        ],
        []
      )
    );

    expect(listNotedPendingVtuReferences()).toEqual(['REF-SIBLING']);
    expect(hasNotedPendingVtuReference(scoped, 'REF-SIBLING')).toBe(true);
  });

  it('filters noted references by scope tag (Codex R143 P1)', () => {
    const mine = buildPendingVtuScopeTag('user-1', 'merchant-1');
    const theirs = buildPendingVtuScopeTag('user-2', 'merchant-1');
    rememberPendingVtuPurchase('{"registry":"a"}', 'key-a', mine);
    notePendingVtuReference('{"registry":"a"}', 'REF-A');
    rememberPendingVtuPurchase('{"registry":"b"}', 'key-b', theirs);
    notePendingVtuReference('{"registry":"b"}', 'REF-B');
    rememberPendingVtuPurchase('{"registry":"c"}', 'key-c');
    notePendingVtuReference('{"registry":"c"}', 'REF-C');

    expect(listNotedPendingVtuReferences(mine).sort()).toEqual([
      'REF-A',
      'REF-C',
    ]);
    expect(listNotedPendingVtuReferences(theirs).sort()).toEqual([
      'REF-B',
      'REF-C',
    ]);
    expect(listNotedPendingVtuReferences().sort()).toEqual([
      'REF-A',
      'REF-B',
      'REF-C',
    ]);
  });
});
