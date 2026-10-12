import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scopePendingVtuSignature } from './utility-pending-idempotency';
import {
  clearPendingVtuKeys,
  forgetPendingVtuPurchase,
  getPendingVtuKey,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import {
  loadPendingVtuSnapshot,
  parsePendingVtuSnapshot,
  PERSISTED_VTU_KEY_TTL_MS,
  savePendingVtuSnapshot,
} from './utility-pending-idempotency-store';

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

  it('drops TTL-expired reference-less entries on recall', () => {
    // Without a reference the stale check cannot flag them, so
    // recalling would replay an already-completed transaction as a
    // new purchase.
    rememberPendingVtuPurchase('{"ttl":"drop"}', 'key-ttl');
    const expired = Date.now() + PERSISTED_VTU_KEY_TTL_MS + 1;
    expect(recallPendingVtuKey('{"ttl":"drop"}', expired)).toBeUndefined();
    // Deletion sticks: a live recall also misses.
    expect(recallPendingVtuKey('{"ttl":"drop"}')).toBeUndefined();
  });

  it('drops TTL-expired referenced entries on recall', () => {
    // No client-side signal proves terminality (noted references mark
    // non-terminal processing responses), so the 7-day TTL applies
    // uniformly — including to referenced entries.
    rememberPendingVtuPurchase('{"ttl":"ref"}', 'key-ttl-ref');
    notePendingVtuReference('{"ttl":"ref"}', 'REF-TTL');
    const expired = Date.now() + PERSISTED_VTU_KEY_TTL_MS + 1;
    expect(recallPendingVtuKey('{"ttl":"ref"}', expired)).toBeUndefined();
    // Deletion sticks: a live recall also misses.
    expect(recallPendingVtuKey('{"ttl":"ref"}')).toBeUndefined();
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

  it('evicts past-TTL entries (even referenced) before live ones', () => {
    // sig-old is referenced but aged past the TTL (live recall would
    // drop it on access anyway); the rest are young. The past-TTL
    // entry goes first — otherwise the cap would wedge once 32
    // referenced entries accumulate.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      rememberPendingVtuPurchase('{"old":"sig"}', 'key-old');
      notePendingVtuReference('{"old":"sig"}', 'REF-OLD');
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
      // Past-TTL referenced victim evicted…
      expect(recallPendingVtuKey('{"old":"sig"}')).toBeUndefined();
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

  it('binds the scoped key to owner and merchant', () => {
    const scopedA = scopePendingVtuSignature(
      'customer-a',
      'merchant-1',
      '{"scoped":true}'
    );

    expect(
      scopePendingVtuSignature('customer-b', 'merchant-1', '{"scoped":true}')
    ).not.toBe(scopedA);
    expect(
      scopePendingVtuSignature('customer-a', 'merchant-2', '{"scoped":true}')
    ).not.toBe(scopedA);
    expect(
      scopePendingVtuSignature('customer-a', 'merchant-1', '{"scoped":true}')
    ).toBe(scopedA);
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

  it('recognizes a noted reference as the replay of its processing vend', () => {
    const signature = '{"noted":true}';
    getPendingVtuKey(signature);

    expect(hasNotedPendingVtuReference(signature, 'REF-1')).toBe(false);
    notePendingVtuReference(signature, 'REF-1');
    expect(hasNotedPendingVtuReference(signature, 'REF-1')).toBe(true);
    expect(hasNotedPendingVtuReference(signature, 'REF-OTHER')).toBe(false);
  });

  it('recalls the pending key after a page reload', async () => {
    const key = getPendingVtuKey('{"reload":true}');
    notePendingVtuReference('{"reload":true}', 'REF-RELOAD');

    // A reload re-executes the module with an empty map; the
    // localStorage entry must restore the pending purchase.
    vi.resetModules();
    const fresh =
      await import('./utility-pending-idempotency');

    expect(fresh.recallPendingVtuKey('{"reload":true}')).toBe(key);
    expect(
      fresh.hasNotedPendingVtuReference('{"reload":true}', 'REF-RELOAD')
    ).toBe(true);
  });

  it('recalls a key another tab persisted after this tab loaded', () => {
    // Cross-tab sequential retry: tab B opened (empty map) before tab
    // A submitted. B's recall must merge the snapshot first, or B
    // mints a second key the route debits as a second transaction.
    savePendingVtuSnapshot(
      JSON.stringify([
        [
          'SIG-XTAB',
          { key: 'key-tab-a', reference: null, rememberedAt: Date.now() },
        ],
      ])
    );

    expect(recallPendingVtuKey('SIG-XTAB')).toBe('key-tab-a');
  });

  it('drops a locally-held entry another tab deleted (tombstone sync)', () => {
    // Tab B holds SIG-DEL in memory while tab A completes it: A's
    // forget persists a snapshot WITHOUT the entry but WITH a
    // tombstone. B's next recall must drop its in-memory copy — if B
    // wrote it back, an identical purchase would replay the completed
    // transaction as a new success without a new debit.
    const key = getPendingVtuKey('SIG-DEL');
    expect(recallPendingVtuKey('SIG-DEL')).toBe(key);

    savePendingVtuSnapshot(
      JSON.stringify({
        entries: [],
        forgotten: [{ scoped: 'SIG-DEL', forgottenAt: Date.now() }],
      })
    );

    expect(recallPendingVtuKey('SIG-DEL')).toBeUndefined();
    // B's next persist carries the tombstone but not the entry.
    getPendingVtuKey('SIG-OTHER');
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries.map(([scoped]) => scoped)).not.toContain(
      'SIG-DEL'
    );
    expect(snapshot.forgotten.map((t) => t.scoped)).toContain('SIG-DEL');
  });

  it('merges a re-remembered entry newer than its tombstone', () => {
    // A forget followed by a same-scope resubmit: the new generation
    // (rememberedAt past the tombstone) must still merge in a third
    // tab, or it would mint fresh and double-debit.
    const now = Date.now();
    savePendingVtuSnapshot(
      JSON.stringify({
        entries: [
          [
            'SIG-NEW',
            { key: 'key-new', reference: null, rememberedAt: now },
          ],
        ],
        forgotten: [{ scoped: 'SIG-NEW', forgottenAt: now - 1000 }],
      })
    );

    expect(recallPendingVtuKey('SIG-NEW')).toBe('key-new');
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
});
