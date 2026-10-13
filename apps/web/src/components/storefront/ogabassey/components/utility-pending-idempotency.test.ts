import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPendingVtuScopeTag } from '@baci/shared';
import { scopePendingVtuSignature } from './utility-pending-vtu-scope';
import {
  clearPendingVtuKeys,
  forgetPendingVtuByReference,
  forgetPendingVtuPurchase,
  getPendingVtuKey,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
  listNotedPendingVtuReferences,
  markPendingVtuCompleted,
  markSettledPendingVtuByReference,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import { PERSISTED_VTU_KEY_TTL_MS } from './utility-pending-vtu-codec';

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

  it('retains TTL-aged unanswered entries on recall', () => {
    // Codex R63 6ruGlp: a lost response leaves the reference null
    // after a possibly-committed debit — dropping the key would mint
    // fresh on retry and debit twice. Only completed entries drop.
    rememberPendingVtuPurchase('{"ttl":"unanswered"}', 'key-ttl');
    const expired = Date.now() + PERSISTED_VTU_KEY_TTL_MS + 1;
    expect(recallPendingVtuKey('{"ttl":"unanswered"}', expired)).toBe(
      'key-ttl'
    );

    rememberPendingVtuPurchase('{"ttl":"done"}', 'key-done');
    const doneAt = Date.now();
    markPendingVtuCompleted('{"ttl":"done"}', doneAt);
    expect(
      recallPendingVtuKey(
        '{"ttl":"done"}',
        doneAt + PERSISTED_VTU_KEY_TTL_MS + 1
      )
    ).toBeUndefined();
    // Deletion sticks: a live recall also misses.
    expect(recallPendingVtuKey('{"ttl":"done"}')).toBeUndefined();
  });

  it('retains TTL-aged referenced entries on recall', () => {
    // Codex R61 6rtSNk: dropping the key mapping for a referenced but
    // never-terminally-observed entry would make the retry mint fresh
    // and debit again while the first charge is still processing.
    rememberPendingVtuPurchase('{"ttl":"ref"}', 'key-ttl-ref');
    notePendingVtuReference('{"ttl":"ref"}', 'REF-TTL');
    const expired = Date.now() + PERSISTED_VTU_KEY_TTL_MS + 1;
    expect(recallPendingVtuKey('{"ttl":"ref"}', expired)).toBe('key-ttl-ref');
    // Retention sticks: a live recall still hits.
    expect(recallPendingVtuKey('{"ttl":"ref"}')).toBe('key-ttl-ref');
  });

  it('overflows past the cap rather than evicting live attempts', () => {
    // Evicting a live (unconfirmed) entry would lose deduplication:
    // retrying it would mint fresh and double-debit. Only past-TTL
    // entries are eviction victims; live overflow is cheap and the
    // 7-day TTL bounds retention.
    const signatures = Array.from(
      { length: 33 },
      (_, index) => `{"n":${index}}`
    );
    const keys = signatures.map((signature) => getPendingVtuKey(signature));

    // Oldest AND newest entries still recall past the cap.
    expect(recallPendingVtuKey(signatures[0])).toBe(keys[0]);
    expect(recallPendingVtuKey(signatures[32])).toBe(keys[32]);
  });

  it('keeps stale referenced entries past the cap (no live victim exists)', () => {
    // Staleness is deliberately NOT a victim criterion: a referenced
    // entry older than five minutes may still be processing, and the
    // stale branch needs its key. With every entry live, the 33rd
    // remember overflows instead of evicting.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      for (let index = 0; index < 32; index++) {
        rememberPendingVtuPurchase(`{"cap":${index}}`, `key-${index}`);
      }
      notePendingVtuReference('{"cap":31}', 'REF-OLD');
      vi.setSystemTime(
        new Date('2026-01-01T00:00:00Z').getTime() +
          PENDING_VTU_STALE_AFTER_MS +
          1000
      );
      rememberPendingVtuPurchase('{"cap":"new"}', 'key-new');
      // Stale-but-referenced survivor kept…
      expect(recallPendingVtuKey('{"cap":31}')).toBe('key-31');
      // …oldest live entry kept too (overflow, not eviction)…
      expect(recallPendingVtuKey('{"cap":0}')).toBe('key-0');
      // …and the new entry recalls.
      expect(recallPendingVtuKey('{"cap":"new"}')).toBe('key-new');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains referenced-processing past-TTL entries at the cap (overflow)', () => {
    // Codex R61 6rtSNk + R63 6ruGlp: sig-old is uncompleted, so the
    // cap cannot evict it — eviction would lose the original key and
    // the retry would double-debit. Only the completed aged entry is
    // a victim; sig-old overflows instead.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      rememberPendingVtuPurchase('{"old":"sig"}', 'key-old');
      notePendingVtuReference('{"old":"sig"}', 'REF-OLD');
      rememberPendingVtuPurchase('{"old":"done"}', 'key-done');
      markPendingVtuCompleted('{"old":"done"}');
      vi.setSystemTime(
        new Date('2026-01-01T00:00:00Z').getTime() +
          PERSISTED_VTU_KEY_TTL_MS -
          60 * 1000
      );
      for (let index = 0; index < 31; index++) {
        rememberPendingVtuPurchase(`{"live":${index}}`, `key-${index}`);
      }
      vi.setSystemTime(
        new Date('2026-01-01T00:00:00Z').getTime() +
          PERSISTED_VTU_KEY_TTL_MS +
          1000
      );
      rememberPendingVtuPurchase('{"live":"new"}', 'key-new');
      // Completed aged victim evicted…
      expect(recallPendingVtuKey('{"old":"done"}')).toBeUndefined();
      // …TTL-aged referenced-processing entry retained (overflow)…
      expect(recallPendingVtuKey('{"old":"sig"}')).toBe('key-old');
      // …young survivors kept.
      expect(recallPendingVtuKey('{"live":0}')).toBe('key-0');
      expect(recallPendingVtuKey('{"live":"new"}')).toBe('key-new');
    } finally {
      vi.useRealTimers();
    }
  });

  it('remembering an existing signature does not evict or rotate it', () => {
    const key = getPendingVtuKey('{"amount":100}');
    rememberPendingVtuPurchase('{"amount":100}', key);

    expect(recallPendingVtuKey('{"amount":100}')).toBe(key);
  });

  it('isolates remembered keys by scoped owner', () => {
    const scopedA = scopePendingVtuSignature(
      'customer-a',
      'merchant-1',
      '{"scoped":true}'
    );
    const scopedB = scopePendingVtuSignature(
      'customer-b',
      'merchant-1',
      '{"scoped":true}'
    );
    const key = getPendingVtuKey(scopedA);

    expect(recallPendingVtuKey(scopedB)).toBeUndefined();
    expect(recallPendingVtuKey(scopedA)).toBe(key);
  });

  it('detects a stale success replay only past the recall window', () => {
    const signature = '{"stale":true}';
    getPendingVtuKey(signature);
    notePendingVtuReference(signature, 'REF-1');
    // Staleness keys off OBSERVED completion: a noted-but-uncompleted
    // entry is never stale, however old the submit.
    expect(
      isStalePendingVtuSuccess(
        signature,
        'REF-1',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);

    markPendingVtuCompleted(signature);
    expect(isStalePendingVtuSuccess(signature, 'REF-1')).toBe(false);
    expect(
      isStalePendingVtuSuccess(
        signature,
        'REF-1',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
    // A different reference is a different transaction, never stale.
    expect(
      isStalePendingVtuSuccess(
        signature,
        'REF-2',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);
  });

  it('presents a slow first completion instead of aging the submit', () => {
    // A 202 noted early, completed minutes later via reconciliation:
    // the replay must present the vend, not "Already Completed" (which
    // would forget the key and double-debit the prompted retry).
    const signature = '{"slow":true}';
    const submittedAt = Date.now();
    getPendingVtuKey(signature);
    notePendingVtuReference(signature, 'REF-SLOW');

    const completedAt = submittedAt + PENDING_VTU_STALE_AFTER_MS + 60_000;
    markPendingVtuCompleted(signature, completedAt);
    expect(
      isStalePendingVtuSuccess(signature, 'REF-SLOW', completedAt + 1000)
    ).toBe(false);
    expect(
      isStalePendingVtuSuccess(
        signature,
        'REF-SLOW',
        completedAt + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('keeps the first completion when re-marked', () => {
    const signature = '{"remark":true}';
    getPendingVtuKey(signature);
    notePendingVtuReference(signature, 'REF-1');
    const first = Date.now();
    markPendingVtuCompleted(signature, first);
    markPendingVtuCompleted(signature, first + 10_000);

    expect(
      isStalePendingVtuSuccess(
        signature,
        'REF-1',
        first + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('forgets retained entries by noted reference on terminal history', () => {
    const signature = '{"settle":true}';
    const key = getPendingVtuKey(signature);
    notePendingVtuReference(signature, 'REF-SETTLE');

    // Unknown references touch nothing.
    forgetPendingVtuByReference('REF-OTHER');
    expect(recallPendingVtuKey(signature)).toBe(key);

    // Observed terminality forgets: the success is shown, so an
    // identical repeat is a new intent that must mint fresh and
    // deliver anew — keeping the key would present the previous vend
    // as the new purchase without delivering anything.
    forgetPendingVtuByReference('REF-SETTLE');

    expect(recallPendingVtuKey(signature)).toBeUndefined();
    expect(getPendingVtuKey(signature)).not.toBe(key);
  });

  it('marks background-settled successes stale without deleting them', () => {
    // Codex R68 6rwG9F: the outcome was never shown in-session, so
    // the retry must be told "Already Completed" — not silently
    // double-charge on a fresh key, and not lose the replay.
    const signature = '{"mark-settle":true}';
    const key = getPendingVtuKey(signature);
    notePendingVtuReference(signature, 'REF-MARK-SETTLE');

    markSettledPendingVtuByReference('REF-OTHER');
    expect(recallPendingVtuKey(signature)).toBe(key);

    markSettledPendingVtuByReference('REF-MARK-SETTLE');

    expect(recallPendingVtuKey(signature)).toBe(key);
    expect(isStalePendingVtuSuccess(signature, 'REF-MARK-SETTLE')).toBe(true);
  });

  it('skips already-marked entries when settling by reference', () => {
    // Codex R68 6rwG9F: suppressed completions keep their fresh mark
    // so the stale guard presents them on replay.
    const signature = '{"mark-skip":true}';
    const key = getPendingVtuKey(signature);
    notePendingVtuReference(signature, 'REF-MARK-SKIP');
    markPendingVtuCompleted(signature);

    markSettledPendingVtuByReference('REF-MARK-SKIP');

    expect(recallPendingVtuKey(signature)).toBe(key);
    expect(isStalePendingVtuSuccess(signature, 'REF-MARK-SKIP')).toBe(false);
  });

  it('recognizes a noted reference as the replay of its processing vend', () => {
    const signature = '{"noted":true}';
    getPendingVtuKey(signature);

    expect(hasNotedPendingVtuReference(signature, 'REF-1')).toBe(false);
    notePendingVtuReference(signature, 'REF-1');
    expect(hasNotedPendingVtuReference(signature, 'REF-1')).toBe(true);
    expect(hasNotedPendingVtuReference(signature, 'REF-OTHER')).toBe(false);
  });

  it('never flags reference-less entries as stale', () => {
    // The user saw failure (any response would have finalized the
    // entry), so a re-tap is definitionally a retry at any age:
    // reusing the key lets the server dedupe, while forcing stale
    // would mint a fresh key and double-debit a slow retry of an
    // already-committed attempt.
    const signature = '{"noref":true}';
    getPendingVtuKey(signature);

    expect(
      isStalePendingVtuSuccess(
        signature,
        'REF-FIRST',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);
  });

  it('lists noted references deduped, excluding unanswered entries', () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('{"l1":true}', 'key-l1');
    notePendingVtuReference('{"l1":true}', 'REF-SHARED');
    rememberPendingVtuPurchase('{"l2":true}', 'key-l2');
    notePendingVtuReference('{"l2":true}', 'REF-SHARED');
    rememberPendingVtuPurchase('{"l3":true}', 'key-l3');

    // One read per reference; the unanswered entry has nothing to
    // look up (Codex R57 6rseWu).
    expect(listNotedPendingVtuReferences()).toEqual(['REF-SHARED']);
  });

  it('filters noted references by scope tag, failing open untagged', () => {
    // Codex R62 6rtokd: the settle pass must not burn history reads
    // on another account's references. Untagged (pre-tag) entries
    // fail open — their owner is unknowable.
    clearPendingVtuKeys();
    const mine = buildPendingVtuScopeTag('user-1', 'merchant-1');
    const theirs = buildPendingVtuScopeTag('user-2', 'merchant-1');
    rememberPendingVtuPurchase('{"a":1}', 'key-a', mine);
    notePendingVtuReference('{"a":1}', 'REF-A');
    rememberPendingVtuPurchase('{"b":2}', 'key-b', theirs);
    notePendingVtuReference('{"b":2}', 'REF-B');
    rememberPendingVtuPurchase('{"c":3}', 'key-c');
    notePendingVtuReference('{"c":3}', 'REF-C');

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
