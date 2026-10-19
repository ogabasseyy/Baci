import { describe, expect, it } from 'vitest';
import {
  getLiveCustomerIdentity,
  hasUtilityPurchaseIdentityMoved,
  publishCustomerIdentity,
} from './customer-live-identity';

describe('customer-live-identity', () => {
  it('publishes the current identity synchronously for settlement checks', () => {
    publishCustomerIdentity({ id: 'user-1' }, { id: 'customer-1' }, 'store-a');
    expect(getLiveCustomerIdentity()).toEqual({
      customerId: 'customer-1',
      merchantSlug: 'store-a',
      userId: 'user-1',
    });

    publishCustomerIdentity(null, null, 'store-a');
    expect(getLiveCustomerIdentity()).toEqual({
      customerId: null,
      merchantSlug: 'store-a',
      userId: null,
    });
  });

  it('detects account and storefront moves against the submitter', () => {
    // Codex R101 P2: the same auth user in a replacement storefront
    // must not receive the old store's result — the merchant leg
    // catches what the user-first account leg masks.
    publishCustomerIdentity({ id: 'user-1' }, { id: 'customer-1' }, 'store-a');
    const submitter = {
      customerId: 'customer-1',
      merchantSlug: 'store-a',
      userId: 'user-1',
    };
    expect(hasUtilityPurchaseIdentityMoved(submitter)).toBe(false);

    // Same user, replacement store + customer: moved.
    publishCustomerIdentity({ id: 'user-1' }, { id: 'customer-2' }, 'store-b');
    expect(hasUtilityPurchaseIdentityMoved(submitter)).toBe(true);

    // Signed out mid-flight: moved.
    publishCustomerIdentity(null, null, 'store-a');
    expect(hasUtilityPurchaseIdentityMoved(submitter)).toBe(true);

    // Hydration skew does not false-positive: a null customer at
    // capture flips on hydration while the user matches.
    publishCustomerIdentity({ id: 'user-1' }, { id: 'customer-1' }, 'store-a');
    expect(
      hasUtilityPurchaseIdentityMoved({
        customerId: null,
        merchantSlug: 'store-a',
        userId: 'user-1',
      })
    ).toBe(false);
  });
});
