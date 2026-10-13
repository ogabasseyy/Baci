import { describe, expect, it } from 'vitest';
import {
  mapUcpCatalogProductRow,
  type UcpCatalogProductRow,
} from './ucp-catalog-adapters';

const validRow: UcpCatalogProductRow = {
  id: 'valid-item',
  merchant_id: 'merchant-1',
  name: 'Valid item',
  price: 100,
  status: 'active',
};

function mapRow(overrides: Partial<UcpCatalogProductRow>) {
  return mapUcpCatalogProductRow({
    baseUrl: 'https://ogabassey.com',
    currency: 'NGN',
    row: { ...validRow, ...overrides },
  });
}

function expectMappedProduct(
  product: ReturnType<typeof mapUcpCatalogProductRow>
) {
  expect(product).not.toBeNull();
  if (!product) {
    throw new Error('Expected a mapped UCP catalog product');
  }
  return product;
}

describe('UCP catalog adapter validation', () => {
  it('refuses rows with unknown prices instead of publishing a free product', () => {
    expect(mapRow({ price: null })).toBeNull();
  });

  it('refuses rows with non-finite or negative prices', () => {
    expect(mapRow({ price: '123abc' })).toBeNull();
    expect(mapRow({ price: -1 })).toBeNull();
    expect(mapRow({ price: Number.NaN })).toBeNull();
    expect(mapRow({ price: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('preserves a valid zero price', () => {
    expect(
      expectMappedProduct(mapRow({ price: '0' })).price_range.min.amount
    ).toBe(0);
  });

  it('refuses rows with a whitespace-only id', () => {
    expect(mapRow({ id: '   ' })).toBeNull();
  });

  it('refuses rows with a nullish id or name', () => {
    expect(mapRow({ id: null })).toBeNull();
    expect(mapRow({ name: undefined })).toBeNull();
  });

  it('refuses rows with a whitespace-only name', () => {
    expect(mapRow({ name: '   ' })).toBeNull();
  });
});
