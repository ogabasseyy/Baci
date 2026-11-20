import { expect, it } from 'vitest';
import { brilStashSourcesSchema } from './brilstash-sources';

const id = '30000000-0000-4000-8000-000000000001';
const row = {
  externalId: 'listing',
  id,
  parentProductId: id,
  kind: 'variant',
  visible: true,
  name: 'Phone',
  slug: 'phone',
  brand: null,
  condition: 'new',
  parentCondition: 'new',
  currency: 'NGN',
  priceNaira: 100,
  partnerCategory: 'Phones',
  categoryId: id,
  factsRevision: '9007199254740993',
  approvedFacts: {
    specifications: 'Phone',
    boxContents: 'Phone',
    warranty: '30 days',
  },
  verifiedImages: Array.from(
    { length: 10 },
    (_, i) => `https://images.example.invalid/${i}`
  ),
  inventory: { kind: 'withdrawn', units: 0, approvalId: id },
};
const snapshot = {
  installationId: id,
  merchantId: id,
  catalogueRevision: '7',
  expectedActiveGenerationId: null,
  sourceReadAt: '2026-11-19T22:00:00+01:00',
  rows: [row],
  previousExternalIds: [],
  retiredExternalIds: [],
};

it('accepts reviewed withdrawal evidence and exactly ten images', () => {
  expect(brilStashSourcesSchema.parse(snapshot)).toEqual(snapshot);
});

it.each([
  { rows: [{ ...row, verifiedImages: [...row.verifiedImages, 'extra'] }] },
  { rows: [{ ...row, inventory: { ...row.inventory, units: 1 } }] },
  {
    rows: [{ ...row, inventory: { ...row.inventory, approvalId: undefined } }],
  },
  { rows: Array.from({ length: 8 }, () => row) },
  { sourceReadAt: '2026-11-19T22:00:00' },
  { catalogueRevision: 7 },
])('rejects inconsistent source evidence %#', (override) => {
  expect(
    brilStashSourcesSchema.safeParse({ ...snapshot, ...override }).success
  ).toBe(false);
});
