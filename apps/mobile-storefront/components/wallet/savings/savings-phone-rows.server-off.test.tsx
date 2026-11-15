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

  it('never offers a product without a real price, but keeps an unloaded preview', () => {
    expect(savingsPhoneRows({ ...base, price: 0 } as Product)).toEqual([]);
    expect(
      savingsPhoneRows({ ...base, price: 0, searchPreview: true } as Product)
    ).toHaveLength(1);
  });

  it('never offers a variant without a real price', () => {
    const rows = savingsPhoneRows({
      ...base,
      variants: [
        { attributes: { storage: '128GB' }, id: 'v0', name: '128GB', price: 0 },
        {
          attributes: { storage: '256GB' },
          id: 'v1',
          name: '256GB',
          price: 650000,
        },
      ],
    } as Product);
    expect(rows.map((row) => row.variantId)).toEqual(['v1']);
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
