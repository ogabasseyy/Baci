import { expect, it } from 'vitest';
import { savingsDraftFixture } from '@/lib/customer-savings-draft.test-fixture';
import { customerSavingsDraftView } from '@/lib/customer-savings-draft-view';
import { customerSavingsDraftPublic as schemas } from './customer-savings-draft-public';

it('accepts the real public DTO and rejects financial fields or mismatched consent', () => {
  const draft = customerSavingsDraftView(savingsDraftFixture().record);
  expect(schemas.draft.parse(draft)).toEqual(draft);
  for (const invalid of [
    { ...draft, balance: 100 },
    { ...draft, device: { ...draft.device, guarantee: true } },
    { ...draft, consent: 'accepted' },
    { ...draft, device: { ...draft.device, variantId: null } },
    { ...draft, terms: { ...draft.terms, text: ' ' } },
  ])
    expect(schemas.draft.safeParse(invalid).success).toBe(false);
});

it('validates public variant IDs and bounds catalogue batches before database reads', () => {
  const product = savingsDraftFixture().record.catalogue;
  const variant = { ...product.variants?.[0], product_id: product.id };
  expect(schemas.catalogueVariants.safeParse([variant]).success).toBe(true);
  expect(
    schemas.catalogueVariants.safeParse([{ ...variant, product_id: 'invalid' }])
      .success
  ).toBe(false);
  expect(
    schemas.catalogueVariants.safeParse(Array(1001).fill(variant)).success
  ).toBe(false);
  expect(
    schemas.catalogue.safeParse([
      { ...product, id: 'invalid', has_variants: true },
    ]).success
  ).toBe(false);
  expect(
    schemas.catalogueQuery.safeParse({ search: 'phone', page: -1 }).success
  ).toBe(false);
});
