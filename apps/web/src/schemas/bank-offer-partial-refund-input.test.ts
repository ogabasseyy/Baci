import { expect, it } from 'vitest';
import {
  partialRefundCliArgsSchema,
  partialRefundDatabaseUrlSchema,
  partialRefundManifestSchema,
} from './bank-offer-partial-refund-input';

const itemId = 'a0000000-0000-4000-8000-000000000001';
const units = [{ itemId: itemId.toUpperCase(), unitNumber: 1 }];

it('normalizes unit IDs and preserves exact decimal refund identifiers', () => {
  expect(
    partialRefundManifestSchema.parse({
      units,
      previousRefunds: [{ refundId: '18446744073709551615', units }],
    })
  ).toEqual({
    units: [{ itemId, unitNumber: 1 }],
    previousRefunds: [
      {
        refundId: '18446744073709551615',
        units: [{ itemId, unitNumber: 1 }],
      },
    ],
  });
});

it('requires prior refund history explicitly and rejects zero-based unit numbers', () => {
  expect(partialRefundManifestSchema.safeParse({ units }).success).toBe(false);
  expect(
    partialRefundManifestSchema.safeParse({
      units: [{ itemId, unitNumber: 0 }],
      previousRefunds: [],
    }).success
  ).toBe(false);
});

it('requires two UUIDs, a manifest path, and a PostgreSQL connection URL', () => {
  expect(
    partialRefundCliArgsSchema.safeParse([itemId, itemId, '/tmp/return.json'])
      .success
  ).toBe(true);
  expect(
    partialRefundCliArgsSchema.safeParse(['bad', itemId, '/tmp/return.json'])
      .success
  ).toBe(false);
  expect(
    partialRefundDatabaseUrlSchema.safeParse(
      'postgresql://db.example.test/postgres'
    ).success
  ).toBe(true);
  expect(
    partialRefundDatabaseUrlSchema.safeParse('https://db.example.test/postgres')
      .success
  ).toBe(false);
});
