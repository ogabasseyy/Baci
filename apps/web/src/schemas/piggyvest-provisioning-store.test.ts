import { describe, expect, it } from 'vitest';
import { piggyvestProvisioningStoreSchemas as schemas } from './piggyvest-provisioning-store';

const identifier = '11111111-1111-4111-8111-111111111111';
const identity = {
  kind: 'create_customer',
  merchantId: identifier,
  customerId: identifier,
  goalId: null,
  providerCustomerId: null,
  requestFingerprint: 'ab'.repeat(32),
};

describe('piggyvestProvisioningStoreSchemas', () => {
  it('requires staging account scope and strict operation identity', () => {
    expect(
      schemas.configuration.safeParse({
        environment: 'staging',
        integrationId: identifier,
        expectedMerchantId: identifier,
        expectedBusinessId: 'synthetic-business',
      }).success
    ).toBe(true);
    expect(schemas.identity.safeParse(identity).success).toBe(true);
    expect(
      schemas.identity.safeParse({
        ...identity,
        kind: 'create_plan_wallet',
        goalId: identifier,
        providerCustomerId: 'synthetic-customer',
      }).success
    ).toBe(true);
  });

  it.each([
    { goalId: identifier },
    { providerCustomerId: 'unexpected' },
    { customerId: 'invalid' },
    { kind: 'create_plan_wallet' },
    { requestFingerprint: 'ab' },
    { requestFingerprint: 'AB'.repeat(32) },
    { body: { bvn: '00000000000' } },
  ])('rejects invalid identity, fingerprint and raw request retention', (change) => {
    expect(schemas.identity.safeParse({ ...identity, ...change }).success).toBe(
      false
    );
  });

  it('accepts only one bounded prepared result with a supported state', () => {
    const row = {
      intent_id: identifier,
      outcome: 'duplicate',
      status: 'unknown',
    };
    expect(schemas.prepared.safeParse([row]).success).toBe(true);
    expect(schemas.prepared.safeParse([]).success).toBe(false);
    expect(schemas.prepared.safeParse([row, row]).success).toBe(false);
    expect(
      schemas.prepared.safeParse([{ ...row, status: 'completed' }]).success
    ).toBe(false);
  });

  it('requires matching result vocabulary and bounded recovery references', () => {
    const record = {
      intentId: identifier,
      claimToken: identifier,
      resultCode: 'accepted',
      providerCustomerId: 'synthetic-customer',
      providerWalletId: 'synthetic-wallet',
    };
    expect(schemas.record.safeParse(record).success).toBe(true);
    expect(
      schemas.record.safeParse({ ...record, providerWalletId: null }).success
    ).toBe(false);
    expect(
      schemas.record.safeParse({ ...record, providerWalletId: 'é'.repeat(257) })
        .success
    ).toBe(false);
    expect(
      schemas.record.safeParse({ ...record, resultCode: 'completed' }).success
    ).toBe(false);
    expect(
      schemas.record.safeParse({ ...record, message: 'provider body' }).success
    ).toBe(false);
    expect(schemas.recorded.safeParse([{ outcome: 'stale' }]).success).toBe(
      true
    );
    expect(schemas.recorded.safeParse([{ outcome: 'completed' }]).success).toBe(
      false
    );
  });
});
