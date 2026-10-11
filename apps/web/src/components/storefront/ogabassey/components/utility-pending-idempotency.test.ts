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
  hydratePendingVtuPurchases,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
  serializePendingVtuPurchases,
} from './utility-pending-idempotency';

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

  it('drops TTL-expired entries on serialize and hydrate', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    getPendingVtuKey('{"ttl":true}');

    expect(serializePendingVtuPurchases(Date.now() + dayMs + 1)).toBe('[]');

    clearPendingVtuKeys();
    hydratePendingVtuPurchases(
      JSON.stringify([
        ['{"ttl":true}', { key: 'k', reference: null, rememberedAt: 1 }],
      ])
    );
    expect(recallPendingVtuKey('{"ttl":true}')).toBeUndefined();
  });

  it('ignores corrupt snapshots on hydrate', () => {
    hydratePendingVtuPurchases('{oops');
    hydratePendingVtuPurchases('"just-a-string"');
    hydratePendingVtuPurchases(JSON.stringify([['nope'], [42, {}], null]));

    expect(recallPendingVtuKey('{"reload":true}')).toBeUndefined();
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
