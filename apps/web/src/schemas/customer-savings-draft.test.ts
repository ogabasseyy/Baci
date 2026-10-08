import { describe, expect, it } from 'vitest';
import { savingsDraftFixture } from '@/lib/customer-savings-draft.test-fixture';
import { customerSavingsDraftSchemas as schemas } from './customer-savings-draft';

describe('local savings draft schemas', () => {
  const fixture = savingsDraftFixture();
  it('accepts exact selection and an explicit simple-product null variant', () => {
    expect(schemas.create.parse(fixture.create)).toEqual(fixture.create);
    expect(
      schemas.create.parse({ ...fixture.create, variantId: null }).variantId
    ).toBeNull();
  });
  it.each([
    'price',
    'customerId',
    'actorId',
    'acceptedAt',
    'balance',
    'schedule',
    'enabled',
  ])('rejects customer-supplied %s', (field) => {
    expect(
      schemas.create.safeParse({ ...fixture.create, [field]: 'untrusted' })
        .success
    ).toBe(false);
  });
  it.each([
    'merchantId',
    'productId',
    'requestId',
    'variantId',
  ])('rejects missing or invalid %s', (field) => {
    const input: Record<string, unknown> = { ...fixture.create };
    delete input[field];
    expect(schemas.create.safeParse(input).success).toBe(false);
    expect(
      schemas.create.safeParse({ ...fixture.create, [field]: 'bad' }).success
    ).toBe(false);
  });
  it('requires explicit true acceptance of a versioned revision', () => {
    expect(schemas.accept.safeParse(fixture.accept).success).toBe(true);
    expect(
      schemas.accept.safeParse({ ...fixture.accept, accepted: false }).success
    ).toBe(false);
    expect(
      schemas.accept.safeParse({ ...fixture.accept, termsHash: 'bad' }).success
    ).toBe(false);
    expect(
      schemas.accept.safeParse({ ...fixture.accept, durationMonths: 3 }).success
    ).toBe(false);
  });
  it('preserves exact document bytes and rejects oversized disclosure', () => {
    const input = {
      ...fixture.record,
      terms: { ...fixture.record.terms, text: '  policy\n' },
    };
    expect(schemas.record.parse(input).terms.text).toBe('  policy\n');
    expect(
      schemas.record.safeParse({
        ...input,
        terms: { ...input.terms, text: 'é'.repeat(16385) },
      }).success
    ).toBe(false);
  });
  it('validates the existing catalogue query without permitting tenant or price injection', () => {
    const query = {
      merchantId: fixture.merchantId,
      search: ' phone ',
      page: '2',
    };
    expect(schemas.catalogue.parse(query)).toEqual({
      merchantId: fixture.merchantId,
      search: 'phone',
      page: 2,
    });
    for (const page of ['-1', '501', '1.5', 'invalid']) {
      expect(schemas.catalogue.safeParse({ ...query, page }).success).toBe(
        false
      );
    }
    expect(schemas.catalogue.safeParse({ ...query, price: 1 }).success).toBe(
      false
    );
    expect(
      schemas.catalogue.safeParse({
        ...query,
        customerId: fixture.record.draftId,
      }).success
    ).toBe(false);
    expect(
      schemas.catalogue.safeParse({ ...query, search: 'x'.repeat(101) }).success
    ).toBe(false);
  });
  it('rejects selection injection and lists over the bounded page size', () => {
    expect(
      schemas.list.safeParse({
        merchantId: fixture.merchantId,
        customerId: fixture.record.draftId,
      }).success
    ).toBe(false);
    expect(
      schemas.policy.safeParse({
        merchantId: fixture.merchantId,
        draftId: fixture.record.draftId,
      }).success
    ).toBe(true);
    expect(
      schemas.listResult.safeParse({
        drafts: Array.from({ length: 51 }, () => fixture.record),
      }).success
    ).toBe(false);
  });
});
