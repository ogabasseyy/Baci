import { describe, expect, it } from 'vitest';
import { piggyvestCustomerGoalSchemas as schemas } from './piggyvest-customer-goal';

describe('persisted customer goal schemas', () => {
  it('retains only display facts from the canonical exact snapshot', () => {
    expect(
      schemas.snapshot.parse({
        name: 'Phone',
        variantId: null,
        variantLabel: null,
        condition: 'new',
        selectionStatus: 'exact',
        price: 100,
        guarantee: true,
      })
    ).toEqual({
      name: 'Phone',
      variantId: null,
      variantLabel: null,
      condition: 'new',
      selectionStatus: 'exact',
    });
  });
  it('rejects legacy snapshots and unmatched variant labels', () => {
    expect(schemas.snapshot.safeParse({ name: 'Phone' }).success).toBe(false);
    expect(
      schemas.snapshot.safeParse({
        name: 'Phone',
        variantId: null,
        variantLabel: '256GB',
        condition: 'new',
        selectionStatus: 'exact',
      }).success
    ).toBe(false);
  });
  it('requires actual timestamp records rather than accepted boolean defaults', () => {
    expect(
      schemas.legacyConsent.safeParse({
        terms_accepted_at: true,
        non_withdrawable_accepted_at: true,
        early_end_fee_accepted_at: null,
      }).success
    ).toBe(false);
    expect(
      schemas.legacyConsent.safeParse({
        terms_accepted_at: '2026-09-01T10:00:00Z',
        non_withdrawable_accepted_at: '2026-09-01T10:00:00Z',
        early_end_fee_accepted_at: null,
      }).success
    ).toBe(true);
  });
  it('rejects caller labels and invalid goal identities', () => {
    expect(
      schemas.scope.safeParse({ customerId: 'bad', goalId: 'bad' }).success
    ).toBe(false);
    expect(
      schemas.scope.safeParse({
        customerId: '11111111-1111-4111-8111-111111111111',
        goalId: '22222222-2222-4222-8222-222222222222',
        device: 'supplied',
      }).success
    ).toBe(false);
  });
});
