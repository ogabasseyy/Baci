import { describe, expect, it } from 'vitest';
import { mcpCatalogRenderInputSchema } from './mcp-catalog-render';

describe('catalog render selection contract', () => {
  it('accepts bounded product identifiers and optional matched option references', () => {
    expect(
      mcpCatalogRenderInputSchema.parse({
        products: [
          {
            product_id: 'phone',
            matched_option: {
              kind: 'variant',
              option_id: 'v1',
              condition: 'new',
            },
          },
          { product_id: 'charger' },
        ],
      })
    ).toEqual({
      products: [
        {
          product_id: 'phone',
          matched_option: {
            kind: 'variant',
            option_id: 'v1',
            condition: 'new',
          },
        },
        { product_id: 'charger' },
      ],
    });
  });
  it.each([
    { products: [] },
    { products: Array(21).fill({ product_id: 'phone' }) },
    { products: [{ product_id: '' }] },
    { products: [{ product_id: 'x'.repeat(81) }] },
    { products: [{ product_id: 'phone', price: 1 }] },
    {
      products: [
        { product_id: 'phone' },
        {
          product_id: 'phone',
          matched_option: { kind: 'base', condition: 'new' },
        },
      ],
    },
    {
      products: [
        {
          product_id: 'phone',
          matched_option: {
            kind: 'variant',
            option_id: 'v1',
            condition: 'new',
            price: 1,
          },
        },
      ],
    },
  ])('rejects malformed or caller-supplied product cards: %j', (input) => {
    expect(mcpCatalogRenderInputSchema.safeParse(input).success).toBe(false);
  });
});
