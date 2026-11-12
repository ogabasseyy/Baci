import type { Product } from '@/types/product';
import { savingsPhoneRows } from './savings-phone-rows';

const base = {
  id: 'p1',
  image: 'https://cdn.example.com/p.jpg',
  name: 'Galaxy S23',
  price: 610000,
  slug: 'galaxy-s23',
} as Product;

describe('savings phone rows', () => {
  it('offers the product itself when it has no variants', () => {
    const [row] = savingsPhoneRows(base);
    expect(row).toMatchObject({
      key: 'p1:default',
      price: 610000,
      variantId: null,
    });
  });

  it('offers each exact variant with its own price, ignoring colour in the label', () => {
    const rows = savingsPhoneRows({
      ...base,
      variants: [
        {
          attributes: { storage: '256GB', color: 'Black' },
          condition: 'new' as const,
          id: 'v1',
          name: '256GB',
          price: 650000,
        },
      ],
    } as Product);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'p1:v1',
      price: 650000,
      variantId: 'v1',
      variantLabel: 'Storage: 256GB',
    });
  });
});
