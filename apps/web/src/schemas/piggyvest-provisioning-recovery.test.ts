import { describe, expect, it } from 'vitest';
import { piggyvestProvisioningRecoverySchemas as schemas } from './piggyvest-provisioning-recovery';

describe('provisioning recovery schemas', () => {
  it('projects only documented wallet readiness fields without customer identity or balances', () => {
    const data = {
      id: 'wallet',
      business_id: 'business',
      currency: 'NGN',
      status: 'active',
    };
    expect(schemas.response.parse({ status: true, data })).toEqual({
      status: true,
      data,
    });
    expect(
      schemas.response.parse({
        status: true,
        data: { ...data, customer_id: 'asserted', balance: 100 },
      })
    ).toEqual({ status: true, data });
  });
  it.each([
    'completed',
    'funded',
    'ready',
  ])('rejects invented observational finality %s', (outcome) => {
    expect(schemas.recorded.safeParse([{ outcome }]).success).toBe(false);
  });
  it('bounds wallet fields and rejects partial observations', () => {
    expect(schemas.observation.safeParse({ id: 'wallet' }).success).toBe(false);
    expect(
      schemas.observation.safeParse({
        id: 'x'.repeat(513),
        business_id: 'business',
        currency: 'NGN',
        status: 'active',
      }).success
    ).toBe(false);
  });
  it('allows only one verification and an explicit boolean completed receipt', () => {
    const row = {
      verification_token: '11111111-1111-4111-8111-111111111111',
      provider_wallet_id: 'wallet',
      completed: false,
    };
    expect(schemas.verification.parse([row])).toEqual([row]);
    expect(schemas.verification.safeParse([row, row]).success).toBe(false);
    expect(
      schemas.verification.safeParse([{ ...row, completed: 'true' }]).success
    ).toBe(false);
  });
});
