import { describe, expect, it, vi } from 'vitest';
import {
  hasNotedPendingVtuReferenceIn,
  isStalePendingVtuSuccessIn,
  listNotedPendingVtuReferencesFrom,
  markPendingVtuCompletedIn,
} from './utility-pending-vtu-reference-queries';

describe('utility-pending-vtu-reference-queries', () => {
  it('matches noted references by signature', () => {
    const entries = new Map([
      ['a', { reference: 'REF-A', completedAt: null }],
      ['b', { reference: null, completedAt: null }],
    ]);

    expect(hasNotedPendingVtuReferenceIn(entries, 'a', 'REF-A')).toBe(true);
    expect(hasNotedPendingVtuReferenceIn(entries, 'a', 'REF-B')).toBe(false);
    expect(hasNotedPendingVtuReferenceIn(entries, 'b', 'REF-A')).toBe(false);
    expect(hasNotedPendingVtuReferenceIn(entries, 'missing', 'REF-A')).toBe(
      false
    );
  });

  it('lists references deduped, skipping unanswered entries', () => {
    const entries = [
      { reference: 'REF-A' },
      { reference: 'REF-A' },
      { reference: null },
      { reference: 'REF-B' },
    ];

    expect(listNotedPendingVtuReferencesFrom(entries)).toEqual([
      'REF-A',
      'REF-B',
    ]);
  });

  it('excludes other owners but fails open untagged entries', () => {
    const entries = [
      { reference: 'REF-MINE', scopeTag: 'user-1|merchant-1' },
      { reference: 'REF-THEIRS', scopeTag: 'user-2|merchant-1' },
      { reference: 'REF-UNTAGGED' },
    ];

    expect(
      listNotedPendingVtuReferencesFrom(entries, 'user-1|merchant-1')
    ).toEqual(['REF-MINE', 'REF-UNTAGGED']);
    expect(listNotedPendingVtuReferencesFrom(entries)).toEqual([
      'REF-MINE',
      'REF-THEIRS',
      'REF-UNTAGGED',
    ]);
  });

  it('keys staleness off completion time, never submit time', () => {
    const entries = new Map([
      ['old', { reference: 'REF-OLD', completedAt: 1000 }],
      ['fresh', { reference: 'REF-FRESH', completedAt: 9000 }],
      ['unobserved', { reference: 'REF-U', completedAt: null }],
      ['other-ref', { reference: 'REF-X', completedAt: 1000 }],
    ]);

    expect(
      isStalePendingVtuSuccessIn(entries, 'old', 'REF-OLD', 10000, 5000)
    ).toBe(true);
    expect(
      isStalePendingVtuSuccessIn(entries, 'fresh', 'REF-FRESH', 10000, 5000)
    ).toBe(false);
    expect(
      isStalePendingVtuSuccessIn(entries, 'unobserved', 'REF-U', 10000, 5000)
    ).toBe(false);
    expect(
      isStalePendingVtuSuccessIn(entries, 'other-ref', 'REF-Y', 10000, 5000)
    ).toBe(false);
    expect(
      isStalePendingVtuSuccessIn(entries, 'missing', 'REF-OLD', 10000, 5000)
    ).toBe(false);
  });

  it('marks completion first-wins and persists only on change', () => {
    const entries = new Map([
      ['a', { reference: 'REF-A', completedAt: null as number | null }],
      ['b', { reference: 'REF-B', completedAt: 1000 as number | null }],
    ]);
    const persist = vi.fn();

    markPendingVtuCompletedIn(entries, persist, 'a', 5000);
    markPendingVtuCompletedIn(entries, persist, 'a', 6000);
    markPendingVtuCompletedIn(entries, persist, 'b', 7000);
    markPendingVtuCompletedIn(entries, persist, 'missing', 8000);

    expect(entries.get('a')?.completedAt).toBe(5000);
    expect(entries.get('b')?.completedAt).toBe(1000);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
