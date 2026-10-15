import { describe, expect, it, vi } from 'vitest';
import { createSearchProductsToolConfig } from './search-products-tool-config';
import {
  createCatalogRenderer,
  catalogRenderInputSchema,
} from './catalog-render-tool';

describe('decoupled catalog rendering', () => {
  it('search returns data without launching a widget', () => {
    const config = createSearchProductsToolConfig('ui://legacy.html');
    expect(config._meta).not.toHaveProperty('openai/outputTemplate');
    expect(config._meta).not.toHaveProperty('ui.resourceUri');
  });
  it('fetches selected IDs once, preserves order and never accepts supplied prices', async () => {
    const lookup = vi.fn(async (id: string) => ({
      structuredContent: {
        products: [
          {
            id,
            name: id,
            price: 10,
            condition: 'new',
            in_stock: true,
            stock_level: 'available',
            stock_confidence: 'high',
          },
        ],
      },
    }));
    const render = createCatalogRenderer(lookup);
    const result = await render({ product_ids: ['second', 'first', 'second'] });
    expect(lookup.mock.calls.map(([id]) => id)).toEqual(['second', 'first']);
    expect(result.structuredContent.products.map((p) => p.id)).toEqual([
      'second',
      'first',
    ]);
    expect(
      catalogRenderInputSchema.safeParse({
        product_ids: ['first'],
        products: [{ price: 1 }],
      }).success,
    ).toBe(false);
  });
  it('fails closed when any lookup fails instead of presenting a partial comparison', async () => {
    const render = createCatalogRenderer(async () => {
      throw new Error('private database details');
    });
    const result = await render({ product_ids: ['missing'] });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.products).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('private database');
  });
  it('rejects empty and oversized selections', () => {
    expect(
      catalogRenderInputSchema.safeParse({ product_ids: [] }).success,
    ).toBe(false);
    expect(
      catalogRenderInputSchema.safeParse({ product_ids: Array(21).fill('id') })
        .success,
    ).toBe(false);
  });
});

it('does not render an unconfirmed price as a zero-priced product', async () => {
  const render = createCatalogRenderer(async () => ({
    structuredContent: {
      products: [
        {
          id: 'phone',
          name: 'Phone',
          price: null,
          condition: 'new',
          in_stock: null,
          stock_level: 'Unconfirmed',
          stock_confidence: 'unconfirmed',
        },
      ],
    },
  }));
  expect((await render({ product_ids: ['phone'] })).isError).toBe(true);
});
