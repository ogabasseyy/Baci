import { describe, expect, it } from 'vitest';
import { paidInterestFixture as fixture } from '@/lib/piggyvest/primary-wallet-paid-interest.test-support';
import { primaryWalletPaidInterestSchemas as schemas } from './primary-wallet-paid-interest';

describe('production paid-interest schemas', () => {
  it('accepts production configuration and the exact verified crosswalk', () => {
    expect(schemas.runtime.safeParse(fixture.config).success).toBe(true);
    expect(schemas.crosswalk.safeParse(fixture.crosswalk).success).toBe(true);
    expect(schemas.wallet.safeParse(fixture.wallet).success).toBe(true);
  });
  it('does not mix staging evidence into production', () => {
    expect(
      schemas.runtime.safeParse({ ...fixture.config, environment: 'staging' })
        .success
    ).toBe(false);
    expect(
      schemas.crosswalk.safeParse({
        ...fixture.crosswalk,
        environment: 'staging',
      }).success
    ).toBe(false);
  });
  it('requires explicit evidence, policy and exact API customer instead of guessed aliases', () => {
    expect(
      schemas.crosswalk.safeParse({
        ...fixture.crosswalk,
        providerEvidenceSha256: '',
      }).success
    ).toBe(false);
    expect(
      schemas.crosswalk.safeParse({ ...fixture.crosswalk, policyReference: '' })
        .success
    ).toBe(false);
    expect(
      schemas.wallet.safeParse({
        ...fixture.wallet,
        data: { ...fixture.wallet.data, api_customer_id: null },
      }).success
    ).toBe(false);
  });
  it.each([
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid provider kobo %s', (amount) => {
    expect(
      schemas.event.safeParse({
        ...fixture.event,
        eventData: { ...fixture.event.eventData, amount },
      }).success
    ).toBe(false);
  });
});
