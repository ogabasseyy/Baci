import { describe, expect, it } from '@jest/globals';
import {
  parseTrackedOrderIds,
  serializeTrackedOrderIds,
} from './claim-store-codec';

describe('claim-store-codec', () => {
  it('keeps versioned claims untouched', () => {
    expect(
      parseTrackedOrderIds(
        JSON.stringify({
          version: 2,
          claims: ['order-1', 'payment_completed:order-1'],
        })
      )
    ).toEqual(['order-1', 'payment_completed:order-1']);
  });

  it('carries v1 bare ids forward without synthesizing completion claims', () => {
    // Pre-namespacing checkouts recorded the native purchase under the
    // bare order id — including for orders created but not yet paid
    // (bank transfer, BNPL). Synthesizing payment_completed entries
    // would permanently suppress the canonical completion when those
    // outstanding orders settle after the upgrade.
    expect(parseTrackedOrderIds(JSON.stringify(['order-unpaid']))).toEqual([
      'order-unpaid',
    ]);
  });

  it('leaves the completion key claimable for an unpaid-then-settled upgrade order', () => {
    // The migrated entries must not include the namespaced completion
    // key: with only the bare purchase id present, the completion lane
    // can still win its own claim when the outstanding order settles —
    // and it will skip the ad purchase because that bare claim is held.
    const migrated = parseTrackedOrderIds(JSON.stringify(['order-unpaid']));
    expect(migrated).toContain('order-unpaid');
    expect(migrated).not.toContain('payment_completed:order-unpaid');
  });

  it('round-trips the versioned envelope', () => {
    expect(parseTrackedOrderIds(serializeTrackedOrderIds(['order-1']))).toEqual(
      ['order-1']
    );
  });

  it('rejects malformed stores', () => {
    expect(parseTrackedOrderIds(null)).toEqual([]);
    expect(parseTrackedOrderIds('not-json')).toEqual([]);
    expect(parseTrackedOrderIds(JSON.stringify({ version: 1 }))).toEqual([]);
  });
});
