import { expect, it } from 'vitest';
import { primarySavingsProvisioningPaginationSchemas as schemas } from './primary-savings-provisioning-pagination';

it('preserves opaque customer identity and deterministic name without normalization', () => {
  const input = {
    customerId: 'customer-with-hyphens',
    walletName: 'baci-save:integration:goal',
  };
  expect(schemas.input.parse(input)).toEqual(input);
  expect(
    schemas.input.safeParse({ ...input, walletId: 'client-selected' }).success
  ).toBe(false);
});
it.each([
  undefined,
  null,
  '',
  123,
])('requires a valid continuation cursor: %s', (endCursor) => {
  expect(
    schemas.page.safeParse({
      paginatedPayload: {
        edges: [],
        pageInfo: { hasNextPage: true, endCursor },
      },
    }).success
  ).toBe(false);
});
it.each([
  undefined,
  null,
  'opaque-cursor',
])('accepts terminal page cursor: %s', (endCursor) => {
  expect(
    schemas.page.safeParse({
      paginatedPayload: {
        edges: [],
        pageInfo: { hasNextPage: false, endCursor },
      },
    }).success
  ).toBe(true);
});
it('rejects missing pagination completeness and overlarge pages', () => {
  expect(
    schemas.page.safeParse({ paginatedPayload: { edges: [] } }).success
  ).toBe(false);
  expect(
    schemas.page.safeParse({
      paginatedPayload: {
        edges: Array.from({ length: 101 }, () => ({
          id: 'wallet',
          name: 'name',
          status: 'active',
        })),
        pageInfo: { hasNextPage: false },
      },
    }).success
  ).toBe(false);
});
