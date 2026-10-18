import { expect, it } from 'vitest';
import { createCatalogRenderer } from './create-catalog-renderer';

const productLookup = async () => ({
  structuredContent: {
    products: [{
      id: 'phone', name: 'Phone', price: 100, base_price: 100,
      base_condition: 'new', base_in_stock: null, condition: 'new',
      in_stock: null, stock_level: 'Confirm availability',
      stock_confidence: 'unconfirmed',
    }],
  },
});

it('fails closed when serialized base stock is depleted or cannot be checked', async () => {
  const input = { products: [{ product_id: 'phone', matched_option: { kind: 'base' as const, condition: 'new' } }] };
  const depleted = createCatalogRenderer(productLookup, async () => 'out_of_stock');
  expect((await depleted(input)).isError).toBe(true);

  const unavailable = createCatalogRenderer(productLookup, async () => 'unknown');
  expect((await unavailable(input)).isError).toBe(true);
});

it('marks a serialized base option in stock when its anchor has available units', async () => {
  const render = createCatalogRenderer(productLookup, async () => 'in_stock');
  const result = await render({
    products: [{ product_id: 'phone', matched_option: { kind: 'base', condition: 'new' } }],
  });
  expect(result.structuredContent.products[0]).toMatchObject({
    in_stock: true,
    stock_level: 'In Stock',
    stock_confidence: 'high',
  });
});
