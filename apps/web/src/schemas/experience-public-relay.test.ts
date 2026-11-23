import { expect, it } from 'vitest';
import {
  experiencePublicRelayCatalogSchema,
  experiencePublicRelayIdentitySchema,
  experiencePublicRelayStateSchema,
} from './experience-public-relay';

const merchantId = '11111111-1111-4111-8111-111111111111';
const productId = '33333333-3333-4333-8333-333333333333';
const variantId = '33333333-3333-4333-8333-333333333334';
const identity = { merchantId, merchantSlug: 'synthetic-merchant', productId };

it('admits exact merchant and product UUIDs with an optional variant', () => {
  expect(experiencePublicRelayIdentitySchema.parse(identity)).toEqual(identity);
  expect(
    experiencePublicRelayIdentitySchema.parse({ ...identity, variantId })
  ).toEqual({
    ...identity,
    variantId,
  });
  for (const field of ['merchantId', 'productId', 'variantId', 'merchantSlug'])
    expect(
      experiencePublicRelayIdentitySchema.safeParse({
        ...identity,
        [field]: '?',
      }).success
    ).toBe(false);
});

it('binds catalog selectors to valid product and merchant fields', () => {
  const input = {
    merchantSlug: 'synthetic-merchant',
    productId,
    productSlug: 'test-device',
  };
  expect(experiencePublicRelayCatalogSchema.parse(input)).toEqual(input);
  expect(
    experiencePublicRelayCatalogSchema.safeParse({
      ...input,
      productSlug: 'a'.repeat(241),
    }).success
  ).toBe(false);
  expect(
    experiencePublicRelayCatalogSchema.safeParse({
      ...input,
      merchantSlug: 'a'.repeat(101),
    }).success
  ).toBe(false);
});

it('binds the state request to a digest and a bounded policy revision', () => {
  const input = {
    slug: 'synthetic-merchant',
    buildDigest: 'a'.repeat(64),
    policyRevision: 'policy-1',
  };
  expect(experiencePublicRelayStateSchema.parse(input)).toEqual(input);
  expect(
    experiencePublicRelayStateSchema.safeParse({
      ...input,
      buildDigest: 'a'.repeat(63),
    }).success
  ).toBe(false);
  expect(
    experiencePublicRelayStateSchema.safeParse({
      ...input,
      policyRevision: 'a'.repeat(129),
    }).success
  ).toBe(false);
});
