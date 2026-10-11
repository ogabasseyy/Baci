import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVtuWalletPayloadSignature,
  scopePendingVtuSignature,
} from './utility-pending-idempotency';
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
import { PERSISTED_VTU_KEY_TTL_MS } from './utility-pending-idempotency-store';

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

  it('keeps recalling referenced entries past the TTL', () => {
    // The stale check arbitrates their success replays; expiring them
    // could mint a fresh key for a still-processing transaction and
    // debit twice.
    rememberPendingVtuPurchase('{"ttl":"keep"}', 'key-ttl-ref');
    notePendingVtuReference('{"ttl":"keep"}', 'REF-TTL');
    const expired = Date.now() + PERSISTED_VTU_KEY_TTL_MS + 1;
    expect(recallPendingVtuKey('{"ttl":"keep"}', expired)).toBe('key-ttl-ref');
  });

  it('evicts the oldest entry past the cap instead of growing unbounded', () => {
    const signatures = Array.from(
      { length: 33 },
      (_, index) => `{"n":${index}}`
    );
    const keys = signatures.map((signature) => getPendingVtuKey(signature));

    // First entry evicted: recall misses and a fresh key is minted.
    expect(recallPendingVtuKey(signatures[0])).toBeUndefined();
    // Newest entries still recall.
    expect(recallPendingVtuKey(signatures[32])).toBe(keys[32]);
  });

  it('evicts stale-completed entries before unresolved ones at the cap', () => {
    // The youngest entry completed long ago (provably terminal); the
    // rest are fresh and potentially unresolved. Evicting the stale
    // entry is outcome-safe (the repeat correctly mints a fresh
    // transaction), while evicting an unresolved one could double-debit.
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
      // Youngest-but-stale victim evicted…
      expect(recallPendingVtuKey('{"cap":31}')).toBeUndefined();
      // …oldest-but-unresolved survivors kept.
      expect(recallPendingVtuKey('{"cap":0}')).toBe('key-0');
      expect(recallPendingVtuKey('{"cap":"new"}')).toBe('key-new');
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts recall-dead entries before anything else at the cap', () => {
    // sig-31 never got a response and aged past the TTL (live recall
    // would drop it on access anyway); sig-0..30 are stale-completed.
    // The recall-dead entry must go first even though it is youngest.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      for (let index = 0; index < 32; index++) {
        rememberPendingVtuPurchase(`{"dead":${index}}`, `key-${index}`);
        if (index < 31) {
          notePendingVtuReference(`{"dead":${index}}`, `REF-${index}`);
        }
      }
      vi.setSystemTime(
        new Date('2026-01-01T00:00:00Z').getTime() +
          PERSISTED_VTU_KEY_TTL_MS +
          1000
      );
      rememberPendingVtuPurchase('{"dead":"new"}', 'key-new');
      // Oldest-stale survivor kept (referenced ⇒ recallable iff present)…
      expect(recallPendingVtuKey('{"dead":0}')).toBe('key-0');
      expect(recallPendingVtuKey('{"dead":"new"}')).toBe('key-new');
    } finally {
      vi.useRealTimers();
    }
  });

  it('remembering an existing signature does not evict or rotate it', () => {
    const key = getPendingVtuKey('{"amount":100}');
    rememberPendingVtuPurchase('{"amount":100}', key);

    expect(recallPendingVtuKey('{"amount":100}')).toBe(key);
  });

  it('signs identical intents identically regardless of key order', () => {
    const a = buildVtuWalletPayloadSignature({
      type: 'airtime',
      amount: 500,
      phoneNumber: '0801',
      walletAmount: 500,
    });
    const b = buildVtuWalletPayloadSignature({
      walletAmount: 500,
      phoneNumber: '0801',
      amount: 500,
      type: 'airtime',
    });

    expect(a).toBe(b);
  });

  it('ignores cosmetic fields so hydration races still replay', () => {
    const base = {
      amount: 500,
      type: 'airtime',
      phoneNumber: '0801',
      walletAmount: 500,
    };
    // customerName normalizes + phone arrives between a timed-out submit
    // and the retry: the retry MUST reuse the pending key.
    const before = buildVtuWalletPayloadSignature({
      ...base,
      customerName: 'Customer',
      merchantSlug: 'ogabassey',
    });
    const after = buildVtuWalletPayloadSignature({
      ...base,
      customerName: 'Test Customer',
      customerPhone: '0801',
      customerAddress: '1 Test St',
      merchantSlug: 'ogabassey',
    });

    expect(after).toBe(before);
  });

  it('distinguishes intents that differ in any fingerprint field', () => {
    const base = {
      amount: 500,
      type: 'airtime',
      phoneNumber: '0801',
      walletAmount: 500,
    };

    expect(
      buildVtuWalletPayloadSignature({ ...base, amount: 1000 })
    ).not.toBe(buildVtuWalletPayloadSignature(base));
    expect(
      buildVtuWalletPayloadSignature({ ...base, phoneNumber: '0802' })
    ).not.toBe(buildVtuWalletPayloadSignature(base));
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

    // A reload re-executes the module with an empty map; the tab's
    // sessionStorage entry must restore the pending purchase.
    vi.resetModules();
    const fresh =
      await import('./utility-pending-idempotency');

    expect(fresh.recallPendingVtuKey('{"reload":true}')).toBe(key);
    expect(
      fresh.hasNotedPendingVtuReference('{"reload":true}', 'REF-RELOAD')
    ).toBe(true);
  });

  it('lets reference-less entries resolve normally even past the window', () => {
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
