import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { primaryWalletOnboardingFingerprints } from './primary-wallet-onboarding-fingerprint';

vi.mock('server-only', () => ({}));

const key = 'test-only-fingerprint-key-not-a-real-secret';
const scope = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
  userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
  integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  businessId: 'business-fixture',
  environment: 'production' as const,
};
const identity = {
  bvn: '00000000000',
  email: 'test@example.com',
  name: 'Test Customer',
  phone: '08000000000',
  third_party_identifier: `baci:${scope.integrationId}:${scope.customerId}`,
};
const hmac = (value: unknown) =>
  createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');

describe('primaryWalletOnboardingFingerprints', () => {
  it('commits only to the scope and the customer identity', () => {
    expect(
      primaryWalletOnboardingFingerprints({ key, scope, identity }).current
    ).toBe(hmac({ scope, request: identity }));
  });

  it('reproduces the commitment stored before interest routing, byte for byte', () => {
    // The earlier request carried the then-fixed accrual flag last.
    expect(
      primaryWalletOnboardingFingerprints({ key, scope, identity }).legacy
    ).toBe(
      hmac({ scope, request: { ...identity, enable_interest_accrual: false } })
    );
  });

  it('keeps the two formats distinct and binds both to the identity', () => {
    const base = primaryWalletOnboardingFingerprints({ key, scope, identity });
    const other = primaryWalletOnboardingFingerprints({
      key,
      scope,
      identity: { ...identity, bvn: '00000000001' },
    });
    expect(base.current).not.toBe(base.legacy);
    expect(other.current).not.toBe(base.current);
    expect(other.legacy).not.toBe(base.legacy);
  });
});
