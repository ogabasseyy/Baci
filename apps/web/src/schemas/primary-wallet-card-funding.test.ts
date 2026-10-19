import { describe, expect, it } from 'vitest';
import { primaryWalletCardFundingFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-funding.test-fixture';
import { primaryWalletCardFundingSchemas as schemas } from './primary-wallet-card-funding';

describe('primary wallet card funding schemas', () => {
  it('accepts a scoped primary funding reservation without a savings goal', () => {
    expect(schemas.reservation.parse(fixture.reservation)).toEqual(
      fixture.reservation
    );
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid kobo amount %s', (amountKobo) => {
    expect(
      schemas.reservation.safeParse({ ...fixture.reservation, amountKobo })
        .success
    ).toBe(false);
  });

  it('rejects a fabricated savings-goal identifier in primary funding', () => {
    expect(
      schemas.reservation.safeParse({
        ...fixture.reservation,
        goalId: fixture.reservation.intentId,
      }).success
    ).toBe(false);
  });

  it('rejects a same-wallet treasury transfer', () => {
    expect(
      schemas.reservation.safeParse({
        ...fixture.reservation,
        sourceWalletId: fixture.reservation.destinationWalletId,
      }).success
    ).toBe(false);
  });

  it('rejects a reference belonging to another checkout intent', () => {
    expect(
      schemas.reservation.safeParse({
        ...fixture.reservation,
        intentId: fixture.reservation.operationId,
      }).success
    ).toBe(false);
  });

  it('rejects production activation through the staging-only adapter', () => {
    expect(
      schemas.reservation.safeParse({
        ...fixture.reservation,
        environment: 'production',
      }).success
    ).toBe(false);
  });

  it('rejects a submitted transfer acknowledgement as ledger completion', () => {
    expect(schemas.acknowledgement.safeParse('submitted').success).toBe(false);
  });
});
