import { describe, expect, it, vi } from 'vitest';
import {
  assertCheckoutIntentOwnership,
  CHECKOUT_OWNERSHIP_ID_KEYS,
  isCheckoutRouteOwner,
} from './primary-wallet-card-checkout-ownership';

vi.mock('server-only', () => ({}));

const scope = {
  environment: 'staging',
  integrationId: '10000000-0000-4000-8000-000000000004',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '10000000-0000-4000-8000-000000000002',
  userId: '10000000-0000-4000-8000-000000000003',
  businessId: 'fixture-business',
};

describe('checkout ownership source of truth', () => {
  it('binds exactly the six immutable IDs, never the email', () => {
    expect([...CHECKOUT_OWNERSHIP_ID_KEYS]).toEqual([
      'environment',
      'integrationId',
      'merchantId',
      'customerId',
      'userId',
      'businessId',
    ]);
  });
  it('accepts an intent that matches on every ownership key', () => {
    expect(() =>
      assertCheckoutIntentOwnership(scope, { ...scope })
    ).not.toThrow();
  });
  it.each([
    ...CHECKOUT_OWNERSHIP_ID_KEYS,
  ])('rejects an intent that differs on %s', (key) => {
    expect(() =>
      assertCheckoutIntentOwnership(scope, { ...scope, [key]: 'changed' })
    ).toThrow('Primary card identity unavailable');
  });
  it('ignores email differences between scope and intent', () => {
    expect(() =>
      assertCheckoutIntentOwnership(
        { ...scope, email: 'new-address@example.test' },
        { ...scope, email: 'original@example.test' }
      )
    ).not.toThrow();
  });
});

describe('route ownership', () => {
  const identity = {
    merchant_id: '10000000-0000-4000-8000-000000000001',
    user_id: '10000000-0000-4000-8000-000000000003',
    email: 'customer@example.test',
  };
  const base = {
    settingsMerchantId: '10000000-0000-4000-8000-000000000001',
    authUserId: '10000000-0000-4000-8000-000000000003',
    authEmail: 'customer@example.test',
    identity,
  };
  it.each([
    'initialize',
    'status',
  ] as const)('accepts the owner on %s', (action) => {
    expect(isCheckoutRouteOwner({ ...base, action })).toBe(true);
  });
  it.each([
    'initialize',
    'status',
  ] as const)('rejects a merchant mismatch on %s', (action) => {
    expect(
      isCheckoutRouteOwner({
        ...base,
        action,
        identity: { ...identity, merchant_id: 'other' },
      })
    ).toBe(false);
  });
  it.each([
    'initialize',
    'status',
  ] as const)('rejects a user mismatch on %s', (action) => {
    expect(
      isCheckoutRouteOwner({
        ...base,
        action,
        identity: { ...identity, user_id: 'other' },
      })
    ).toBe(false);
  });
  it('requires the stored email on initialize', () => {
    expect(
      isCheckoutRouteOwner({
        ...base,
        action: 'initialize',
        authEmail: 'new-address@example.test',
      })
    ).toBe(false);
    // Case-insensitive: delivery casing must not strand initialization.
    expect(
      isCheckoutRouteOwner({
        ...base,
        action: 'initialize',
        authEmail: 'Customer@Example.Test',
      })
    ).toBe(true);
  });
  it('recovers by IDs alone on status after an email change', () => {
    expect(
      isCheckoutRouteOwner({
        ...base,
        action: 'status',
        authEmail: 'new-address@example.test',
      })
    ).toBe(true);
  });
});
