import { describe, expect, it } from 'vitest';
import { mcpCatalogRenderInputSchema } from './mcp-catalog-render';

describe('catalog render selection contract', () => {
  it('accepts only bounded product identifiers, preserving selection order', () => {
    expect(
      mcpCatalogRenderInputSchema.parse({ product_ids: ['phone', 'charger'] })
    ).toEqual({ product_ids: ['phone', 'charger'] });
  });
  it.each([
    { product_ids: [] },
    { product_ids: Array(21).fill('phone') },
    { product_ids: [''] },
    { product_ids: ['x'.repeat(81)] },
    { product_ids: ['phone'], products: [{ price: 1 }] },
  ])('rejects malformed or caller-supplied product cards: %j', (input) => {
    expect(mcpCatalogRenderInputSchema.safeParse(input).success).toBe(false);
  });
});
