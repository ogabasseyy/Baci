import { describe, expect, it } from 'vitest';
import { prefundedCardTransferVerificationFixture as fixture } from '../lib/piggyvest/prefunded-card-transfer-verification.test-fixture';
import { prefundedCardTransferVerificationSchemas as schemas } from './prefunded-card-transfer-verification';

describe('typed rich TSQ and independent ownership', () => {
  it('accepts the synthetic captured rich shape without inventing absent normalized fields', () => {
    expect(schemas.rich.parse(fixture.transaction).data).toMatchObject({
      status: 'successful',
      amount: 10000,
      fee: 0,
      customer_id: 'business_1',
      third_party_reference: 'pvbt-synthetic-transfer',
    });
    expect(schemas.normalized.safeParse(fixture.transaction).success).toBe(
      false
    );
  });

  it.each([
    'id',
    'internal_reference',
    'reference',
    'third_party_reference',
    'customer_id',
    'source_wallet',
    'destination_wallet',
  ])('rejects whitespace and control characters in %s', (field) => {
    for (const value of [
      ' bad-id',
      'bad id',
      'bad\u0000id',
      'bad\u007fid',
      '',
    ]) {
      expect(
        schemas.rich.safeParse({
          ...fixture.transaction,
          data: { ...fixture.transaction.data, [field]: value },
        }).success
      ).toBe(false);
    }
  });

  it.each(['amount', 'fee'])('rejects coerced %s values', (field) => {
    expect(
      schemas.rich.safeParse({
        ...fixture.transaction,
        data: { ...fixture.transaction.data, [field]: '0' },
      }).success
    ).toBe(false);
  });

  it('rejects incomplete, extra or disabled binding authority', () => {
    expect(schemas.ownership.safeParse(fixture.ownership).success).toBe(true);
    expect(
      schemas.ownership.safeParse({ ...fixture.ownership, approved: true })
        .success
    ).toBe(false);
    expect(
      schemas.ownership.safeParse({
        ...fixture.ownership,
        binding: { ...fixture.ownership.binding, enabled: false },
      }).success
    ).toBe(false);
    const { evidenceSha256: _pin, ...crosswalk } = fixture.ownership.crosswalk;
    expect(
      schemas.ownership.safeParse({ ...fixture.ownership, crosswalk }).success
    ).toBe(false);
  });

  it('separates one-time reviewed identity from generic authoritative runtime crosswalk', () => {
    const reviewed = {
      ...fixture.ownership,
      crosswalk: {
        ...fixture.ownership.crosswalk,
        authority: 'owner_reviewed_provisioning_identity',
      },
    };
    expect(schemas.ownership.safeParse(reviewed).success).toBe(true);
    expect(schemas.runtimeOwnership.safeParse(reviewed).success).toBe(false);
  });
});
