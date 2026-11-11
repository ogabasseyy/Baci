import { expect, it } from 'vitest';
import {
  experienceCatalogRowSchema,
  experienceCatalogSelectionSchema,
} from './experience-catalog';

it('bounds public selection and strips private economics from explicit source rows', () => {
  expect(
    experienceCatalogSelectionSchema.safeParse({ limit: 101 }).success
  ).toBe(false);
  expect(
    experienceCatalogSelectionSchema.safeParse({ merchantId: 'other' }).success
  ).toBe(false);
  const row = experienceCatalogRowSchema.parse({
    id: 'p',
    merchant_id: 'm',
    slug: 'p',
    name: 'Synthetic',
    price: '250',
    status: 'active',
    cost_price: 1,
    ownerToken: 'private',
  });
  expect(row.price).toBe(250);
  expect(JSON.stringify(row)).not.toContain('private');
  expect(row).not.toHaveProperty('cost_price');
});
